// .http request files (the format VS Code's REST Client and JetBrains use):
//
//   @base = http://localhost:3000
//
//   ### List users
//   GET {{base}}/users
//   Accept: application/json
//
//   ### Create a user
//   POST {{base}}/users
//   Content-Type: application/json
//
//   {"name": "Ada"}
export interface HttpRequest {
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  // 1-based line of the request line, to jump to it in the source.
  line: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
  ms: number;
  bytes: number;
  truncated: boolean;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const REQUEST_LINE = new RegExp(`^(${METHODS.join('|')})\\s+(\\S+)(?:\\s+HTTP/[\\d.]+)?\\s*$`, 'i');

export function parseHttpFile(text: string): { requests: HttpRequest[]; variables: Record<string, string> } {
  const lines = text.split(/\r?\n/);
  const variables: Record<string, string> = {};
  const requests: HttpRequest[] = [];
  let name = '';
  let current: HttpRequest | null = null;
  let inBody = false;
  let body: string[] = [];

  const finish = () => {
    if (current) {
      current.body = body.join('\n').replace(/\s+$/, '');
      requests.push(current);
    }
    current = null;
    inBody = false;
    body = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('###')) {
      finish();
      name = line.slice(3).trim();
      return;
    }
    if (!current) {
      const v = /^@([\w.-]+)\s*=\s*(.*)$/.exec(line);
      if (v) variables[v[1]] = v[2].trim();
      const m = REQUEST_LINE.exec(line.trim());
      if (m) {
        current = { name: name || `${m[1].toUpperCase()} ${m[2]}`, method: m[1].toUpperCase(), url: m[2], headers: [], body: '', line: i + 1 };
        name = '';
      } else if (/^(https?:\/\/|\{\{)/.test(line.trim())) {
        // A bare URL means GET.
        current = { name: name || `GET ${line.trim()}`, method: 'GET', url: line.trim(), headers: [], body: '', line: i + 1 };
        name = '';
      }
      return;
    }
    if (inBody) {
      body.push(raw);
      return;
    }
    if (line.trim() === '') {
      inBody = true;
      return;
    }
    if (/^\s*(#|\/\/)/.test(line)) return;
    const h = /^([^:\s]+)\s*:\s*(.*)$/.exec(line);
    if (h) current.headers.push([h[1], h[2]]);
  });
  finish();
  return { requests, variables };
}

// {{name}} from @name = value lines; {{$timestamp}} and {{$uuid}} are built in.
export function resolve(text: string, variables: Record<string, string>, now = Date.now): string {
  return text.replace(/\{\{\s*([$\w.-]+)\s*\}\}/g, (all, key: string) => {
    if (key === '$timestamp') return String(Math.floor(now() / 1000));
    if (key === '$uuid') return uuid();
    const value = variables[key];
    return value === undefined ? all : resolve(value, variables, now);
  });
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function resolveRequest(req: HttpRequest, variables: Record<string, string>): HttpRequest {
  return {
    ...req,
    url: resolve(req.url, variables),
    headers: req.headers.map(([k, v]) => [k, resolve(v, variables)]),
    body: resolve(req.body, variables),
  };
}

export const MAX_BODY_CHARS = 1_000_000;
export const TIMEOUT_MS = 30_000;

export async function send(req: HttpRequest, fetchImpl: typeof fetch = fetch, clock = () => Date.now()): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = clock();
  try {
    const res = await fetchImpl(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'GET' || req.method === 'HEAD' || !req.body ? undefined : req.body,
      signal: controller.signal,
    });
    const text = req.method === 'HEAD' ? '' : await res.text();
    const headers: [string, string][] = [];
    res.headers.forEach((value, key) => headers.push([key, value]));
    return {
      status: res.status,
      statusText: res.statusText,
      headers,
      body: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) : text,
      ms: clock() - started,
      bytes: new TextEncoder().encode(text).length,
      truncated: text.length > MAX_BODY_CHARS,
    };
  } catch (e) {
    if (controller.signal.aborted) throw new Error(`No response after ${TIMEOUT_MS / 1000} seconds`);
    const message = e instanceof Error ? e.message : String(e);
    // iOS only allows plain http:// to local servers.
    if (/^http:\/\//i.test(req.url) && !isLocal(req.url)) throw new Error(`${message}. iOS only allows http:// for servers on this device or your local network; use https://.`);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

export function isLocal(url: string): boolean {
  const host = /^\w+:\/\/([^/:?#]+)/.exec(url)?.[1] ?? '';
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);
}

// Pretty-prints JSON bodies; anything else is shown as it came.
export function formatBody(body: string, headers: [string, string][]): string {
  const type = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  if (/json/i.test(type) || /^\s*[[{]/.test(body)) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }
  return body;
}

export const HTTP_TEMPLATE = `# Send a request with its Send button. Separate requests with ###.
@base = http://localhost:3000

### Get the home page
GET {{base}}/

### Send JSON
POST {{base}}/api/items
Content-Type: application/json

{
  "name": "Example",
  "createdAt": {{$timestamp}}
}
`;

// Environments, in the JetBrains HTTP Client format, next to the .http file or
// at the project root: http-client.env.json, and http-client.private.env.json
// for secrets (its values win). { "dev": { "base": "http://localhost:3000" } }
export const ENV_FILE = 'http-client.env.json';
export const PRIVATE_ENV_FILE = 'http-client.private.env.json';

export type Environments = Record<string, Record<string, string>>;

export function parseEnvironments(...texts: (string | null)[]): Environments {
  const out: Environments = {};
  for (const text of texts) {
    if (!text) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    if (!json || typeof json !== 'object') continue;
    for (const [name, vars] of Object.entries(json as Record<string, unknown>)) {
      if (!vars || typeof vars !== 'object' || Array.isArray(vars)) continue;
      out[name] = { ...out[name], ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])) };
    }
  }
  return out;
}

export const ENV_TEMPLATE = `${JSON.stringify(
  {
    dev: { base: 'http://localhost:3000' },
    prod: { base: 'https://example.com' },
  },
  null,
  2,
)}\n`;

// A file name for a saved response: the request's name, with the right extension.
export function responseFileName(requestName: string, headers: [string, string][]): string {
  const type = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  const ext = /json/i.test(type) ? 'json' : /html/i.test(type) ? 'html' : /xml/i.test(type) ? 'xml' : /csv/i.test(type) ? 'csv' : 'txt';
  const slug = requestName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'response';
  return `responses/${slug}.${ext}`;
}
