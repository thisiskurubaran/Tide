// cURL commands to and from .http requests: paste one copied from API docs or a
// browser's "Copy as cURL", or copy a request out to run it elsewhere.
import { toBase64 } from '../backup/zip';
import type { HttpRequest } from './http';

export class CurlError extends Error {}

export type CurlRequest = Pick<HttpRequest, 'method' | 'url' | 'headers' | 'body'>;

// Splits a command line the way a POSIX shell would: quotes, backslashes,
// line continuations and bash's $'...' strings.
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = '';
  let started = false;
  let i = 0;
  const s = command;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && (s[i + 1] === '\n' || (s[i + 1] === '\r' && s[i + 2] === '\n'))) {
      i += s[i + 1] === '\r' ? 3 : 2;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = '';
      started = false;
      i++;
    } else if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new CurlError('A quote is never closed.');
      word += s.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (c === '$' && s[i + 1] === "'") {
      i += 2;
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\' && i + 1 < s.length) {
          const e = s[i + 1];
          const simple: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '0': '\0' };
          if (e in simple) {
            word += simple[e];
            i += 2;
          } else if (e === 'x' || e === 'u') {
            const len = e === 'x' ? 2 : 4;
            word += String.fromCharCode(parseInt(s.slice(i + 2, i + 2 + len), 16));
            i += 2 + len;
          } else {
            word += e;
            i += 2;
          }
        } else word += s[i++];
      }
      if (i >= s.length) throw new CurlError('A quote is never closed.');
      i++;
      started = true;
    } else if (c === '"') {
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && '"\\$`\n'.includes(s[i + 1])) {
          if (s[i + 1] !== '\n') word += s[i + 1];
          i += 2;
        } else word += s[i++];
      }
      if (i >= s.length) throw new CurlError('A quote is never closed.');
      i++;
      started = true;
    } else if (c === '\\') {
      word += s[i + 1] ?? '';
      started = true;
      i += 2;
    } else {
      word += c;
      started = true;
      i++;
    }
  }
  if (started) words.push(word);
  return words;
}

const IGNORED = new Set([
  '-L', '--location', '-s', '--silent', '-S', '--show-error', '-k', '--insecure', '-i', '--include', '-v', '--verbose',
  '--compressed', '-f', '--fail', '-#', '--progress-bar', '-N', '--no-buffer', '--http1.1', '--http2', '-g', '--globoff',
]);
// Options that take a value we don't use.
const IGNORED_WITH_VALUE = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '--retry', '-w', '--write-out', '--cacert', '--cert', '--key', '-x', '--proxy']);

export function parseCurl(command: string): CurlRequest {
  const words = shellWords(command.trim().replace(/^\$\s+/, ''));
  if (words[0] !== 'curl') throw new CurlError('That doesn’t start with curl.');
  let method: string | null = null;
  let url: string | null = null;
  const headers: [string, string][] = [];
  const data: string[] = [];
  let get = false;
  const header = (name: string, value: string) => {
    if (!headers.some(([k]) => k.toLowerCase() === name.toLowerCase())) headers.push([name, value]);
  };

  for (let i = 1; i < words.length; i++) {
    let w = words[i];
    let inline: string | null = null;
    // --opt=value, and -Xvalue for short options.
    if (w.startsWith('--') && w.includes('=')) {
      inline = w.slice(w.indexOf('=') + 1);
      w = w.slice(0, w.indexOf('='));
    } else if (/^-[XHdAbeu]./.test(w)) {
      inline = w.slice(2);
      w = w.slice(0, 2);
    }
    const value = () => {
      if (inline !== null) return inline;
      if (i + 1 >= words.length) throw new CurlError(`${w} needs a value.`);
      return words[++i];
    };
    switch (w) {
      case '-X':
      case '--request':
        method = value().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const h = value();
        const colon = h.indexOf(':');
        if (colon > 0) headers.push([h.slice(0, colon).trim(), h.slice(colon + 1).trim()]);
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push(value());
        break;
      case '--data-urlencode': {
        const v = value();
        const eq = v.indexOf('=');
        data.push(eq >= 0 ? `${v.slice(0, eq + 1)}${encodeURIComponent(v.slice(eq + 1))}` : encodeURIComponent(v));
        break;
      }
      case '--json':
        data.push(value());
        header('Content-Type', 'application/json');
        header('Accept', 'application/json');
        break;
      case '-u':
      case '--user':
        headers.push(['Authorization', `Basic ${toBase64(new TextEncoder().encode(value()))}`]);
        break;
      case '-A':
      case '--user-agent':
        headers.push(['User-Agent', value()]);
        break;
      case '-b':
      case '--cookie':
        headers.push(['Cookie', value()]);
        break;
      case '-e':
      case '--referer':
        headers.push(['Referer', value()]);
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '-I':
      case '--head':
        method = 'HEAD';
        break;
      case '--url':
        url = value();
        break;
      case '-F':
      case '--form':
        throw new CurlError('Form uploads (-F) aren’t supported in .http files yet.');
      default:
        if (IGNORED.has(w)) break;
        if (IGNORED_WITH_VALUE.has(w)) {
          value();
          break;
        }
        if (w.startsWith('-') && w.length > 1) break;
        url ??= w;
    }
  }
  if (!url) throw new CurlError('There’s no URL in that command.');
  if (!/^[a-z]+:\/\//i.test(url)) url = `http://${url}`;

  let body = data.join('&');
  if (get && body) {
    url += (url.includes('?') ? '&' : '?') + body;
    body = '';
  }
  if (body && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  return { method: method ?? (get ? 'GET' : body ? 'POST' : 'GET'), url, headers, body };
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: CurlRequest): string {
  const parts = ['curl'];
  const implied = req.body ? 'POST' : 'GET';
  if (req.method !== implied) parts.push(req.method === 'HEAD' ? '--head' : `-X ${req.method}`);
  parts.push(quote(req.url));
  for (const [k, v] of req.headers) parts.push(`-H ${quote(`${k}: ${v}`)}`);
  if (req.body && req.method !== 'GET' && req.method !== 'HEAD') parts.push(`--data-raw ${quote(req.body)}`);
  return parts.join(' \\\n  ');
}

// A request as .http text, to append to a file.
export function toHttpText(req: CurlRequest, name: string): string {
  const lines = [`### ${name}`, `${req.method} ${req.url}`, ...req.headers.map(([k, v]) => `${k}: ${v}`)];
  let body = req.body;
  if (body && req.headers.some(([k, v]) => k.toLowerCase() === 'content-type' && /json/i.test(v))) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Keep it as it came.
    }
  }
  if (body) lines.push('', body);
  return `${lines.join('\n')}\n`;
}
