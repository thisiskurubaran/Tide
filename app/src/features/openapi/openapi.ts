// OpenAPI 3 and Swagger 2 specs: the endpoints they describe, and each one as
// a request for a .http file, with an example body built from its schema.
import YAML from 'yaml';

export interface Param {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  type: string;
  description: string;
}

export interface Operation {
  method: string;
  path: string;
  summary: string;
  description: string;
  tag: string;
  deprecated: boolean;
  params: Param[];
  body: { contentType: string; example: string } | null;
}

export interface Spec {
  title: string;
  version: string;
  servers: string[];
  operations: Operation[];
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const MAX_DEPTH = 6;

type Json = any;

export function parseSpec(text: string): Spec {
  let doc: Json;
  try {
    doc = /^\s*\{/.test(text) ? JSON.parse(text) : YAML.parse(text);
  } catch (e) {
    throw new Error(`This file couldn't be read: ${(e as Error).message.split('\n')[0]}`);
  }
  if (!doc || typeof doc !== 'object' || (!doc.openapi && !doc.swagger)) throw new Error('This isn’t an OpenAPI or Swagger file (it has no "openapi" or "swagger" field).');
  const swagger2 = !!doc.swagger;

  // Local $refs only: "#/components/schemas/User" or "#/definitions/User".
  const deref = (node: Json, seen = new Set<string>()): Json => {
    if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
    const ref: string = node.$ref;
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    seen.add(ref);
    const target = ref
      .slice(2)
      .split('/')
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((o: Json, k) => (o == null ? o : o[k]), doc);
    return deref(target ?? {}, seen);
  };

  const example = (schemaIn: Json, depth = 0, seen = new Set<string>()): unknown => {
    if (schemaIn?.$ref) {
      if (seen.has(schemaIn.$ref)) return {};
      seen = new Set(seen).add(schemaIn.$ref);
    }
    const schema = deref(schemaIn);
    if (!schema || typeof schema !== 'object') return null;
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (depth > MAX_DEPTH) return null;
    const pick = schema.allOf ?? null;
    if (Array.isArray(pick)) return Object.assign({}, ...pick.map((s: Json) => example(s, depth + 1, seen)).filter((v: unknown) => v && typeof v === 'object'));
    const alt = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(alt) && alt.length) return example(alt[0], depth + 1, seen);
    const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== 'null') : schema.type;
    if (type === 'object' || schema.properties) {
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, example(v, depth + 1, seen)]));
    }
    if (type === 'array') return [example(schema.items ?? {}, depth + 1, seen)];
    if (type === 'integer' || type === 'number') return 0;
    if (type === 'boolean') return false;
    if (type === 'string') return schema.format === 'date-time' ? '2026-01-01T00:00:00Z' : schema.format === 'date' ? '2026-01-01' : schema.format === 'email' ? 'user@example.com' : schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'string';
    return null;
  };

  const servers: string[] = swagger2
    ? doc.host
      ? (doc.schemes?.length ? doc.schemes : ['https']).map((s: string) => `${s}://${doc.host}${doc.basePath ?? ''}`)
      : [doc.basePath ?? '']
    : (doc.servers ?? []).map((s: Json) => String(s.url ?? '').replace(/\{(\w+)\}/g, (_: string, v: string) => s.variables?.[v]?.default ?? `{${v}}`));

  const operations: Operation[] = [];
  for (const [path, itemIn] of Object.entries<Json>(doc.paths ?? {})) {
    const item = deref(itemIn);
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      const raw: Json[] = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => deref(p));
      // An operation's own parameter replaces a path-level one with the same name and place.
      const byKey = new Map<string, Json>();
      for (const p of raw) byKey.set(`${p.in}:${p.name}`, p);
      const params: Param[] = [];
      let body: Operation['body'] = null;
      for (const p of byKey.values()) {
        if (p.in === 'body') {
          body = { contentType: 'application/json', example: JSON.stringify(example(p.schema), null, 2) };
          continue;
        }
        if (p.in === 'formData') continue;
        const schema = deref(p.schema ?? p);
        params.push({ name: p.name, in: p.in, required: !!p.required || p.in === 'path', type: schema?.type ?? 'string', description: p.description ?? '' });
      }
      if (!swagger2 && op.requestBody) {
        const rb = deref(op.requestBody);
        const content = rb.content ?? {};
        const type = Object.keys(content).find((t) => /json/i.test(t)) ?? Object.keys(content)[0];
        if (type) {
          const media = content[type];
          const ex = media.example ?? (media.examples ? deref(Object.values<Json>(media.examples)[0])?.value : undefined) ?? example(media.schema);
          body = { contentType: type, example: /json/i.test(type) ? JSON.stringify(ex, null, 2) : String(ex ?? '') };
        }
      }
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? op.operationId ?? '',
        description: op.description ?? '',
        tag: op.tags?.[0] ?? 'Other',
        deprecated: !!op.deprecated,
        params,
        body,
      });
    }
  }
  return { title: doc.info?.title ?? 'API', version: doc.info?.version ?? '', servers, operations };
}

// The operation as a .http request: {{baseUrl}} for the server, and a
// variable for each path and required query parameter.
export function toHttp(op: Operation): string {
  const path = op.path.replace(/\{([^}]+)\}/g, '{{$1}}');
  const query = op.params.filter((p) => p.in === 'query' && p.required).map((p) => `${encodeURIComponent(p.name)}={{${p.name}}}`);
  const headers = op.params.filter((p) => p.in === 'header' && p.required).map((p) => `${p.name}: {{${p.name}}}`);
  const lines = [`### ${op.summary || `${op.method} ${op.path}`}`, `${op.method} {{baseUrl}}${path}${query.length ? `?${query.join('&')}` : ''}`];
  if (op.body) lines.push(`Content-Type: ${op.body.contentType}`);
  lines.push(...headers);
  if (op.body) lines.push('', op.body.example);
  return `${lines.join('\n')}\n`;
}

// Text to append to a .http file: a baseUrl variable the first time, then the request.
export function appendRequest(existing: string, op: Operation, server: string): string {
  const head = /^@baseUrl\s*=/m.test(existing) ? '' : `@baseUrl = ${server.replace(/\/$/, '')}\n\n`;
  const sep = existing && !existing.endsWith('\n\n') ? (existing.endsWith('\n') ? '\n' : '\n\n') : '';
  return `${existing}${sep}${head}${toHttp(op)}`;
}
