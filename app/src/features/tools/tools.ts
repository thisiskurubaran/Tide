// The developer toolbox: small conversions that run on the device, offline.
// Each tool takes text and gives text, or throws an Error with a readable
// message for bad input.
import { md5, sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import YAML from 'yaml';

import { fromBase64, toBase64 } from '../backup/zip';

const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(b);

export function formatJson(input: string, indent = 2): string {
  return JSON.stringify(parseJson(input), null, indent);
}

export const minifyJson = (input: string) => JSON.stringify(parseJson(input));

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (e) {
    const m = /position (\d+)/.exec(String((e as Error).message));
    if (m) {
      const at = Number(m[1]);
      const line = input.slice(0, at).split('\n').length;
      throw new Error(`Not valid JSON: ${(e as Error).message.replace(/ in JSON at position \d+.*/, '')} on line ${line}.`);
    }
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
}

export function yamlToJson(input: string): string {
  try {
    return JSON.stringify(YAML.parse(input), null, 2);
  } catch (e) {
    throw new Error(`Not valid YAML: ${(e as Error).message.split('\n')[0]}`);
  }
}

export const jsonToYaml = (input: string) => YAML.stringify(parseJson(input));

// RFC 4180 CSV to an array of objects keyed by the header row.
export function csvToJson(input: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows.filter((r) => r.some((f) => f !== ''));
  if (!header) return '[]';
  return JSON.stringify(
    data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))),
    null,
    2,
  );
}

export const base64Encode = (input: string) => toBase64(utf8(input));

export function base64Decode(input: string): string {
  const clean = input.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('Not Base64: it has characters Base64 doesn’t use.');
  try {
    return text(fromBase64(clean + '='.repeat((4 - (clean.length % 4)) % 4)));
  } catch {
    throw new Error('That decodes to binary data, not text.');
  }
}

export const urlEncode = (input: string) => encodeURIComponent(input);

export function urlDecode(input: string): string {
  try {
    return decodeURIComponent(input.replace(/\+/g, ' '));
  } catch {
    throw new Error('Not URL-encoded: a % isn’t followed by two hex digits.');
  }
}

export interface DecodedJwt {
  header: unknown;
  payload: unknown;
  // Readable dates for exp, iat and nbf, and whether it has expired.
  notes: string[];
}

// Decodes a JWT without checking its signature (there's no key to check it with).
export function decodeJwt(input: string, now = Date.now()): DecodedJwt {
  const parts = input.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) throw new Error('Not a JWT: it should be three parts separated by dots.');
  const part = (p: string, name: string) => {
    try {
      return JSON.parse(base64Decode(p));
    } catch {
      throw new Error(`Not a JWT: the ${name} isn’t Base64-encoded JSON.`);
    }
  };
  const header = part(parts[0], 'header');
  const payload = part(parts[1], 'payload') as Record<string, unknown>;
  const notes: string[] = [];
  for (const [claim, label] of [
    ['iat', 'Issued'],
    ['nbf', 'Valid from'],
    ['exp', 'Expires'],
  ] as const) {
    const v = payload?.[claim];
    if (typeof v === 'number') notes.push(`${label}: ${new Date(v * 1000).toISOString()}`);
  }
  if (typeof payload?.exp === 'number') notes.push(payload.exp * 1000 < now ? 'This token has expired.' : 'Not expired yet.');
  notes.push('The signature isn’t checked.');
  return { header, payload, notes };
}

export function hashes(input: string): { name: string; value: string }[] {
  const bytes = utf8(input);
  return [
    { name: 'MD5', value: bytesToHex(md5(bytes)) },
    { name: 'SHA-1', value: bytesToHex(sha1(bytes)) },
    { name: 'SHA-256', value: bytesToHex(sha256(bytes)) },
    { name: 'SHA-512', value: bytesToHex(sha512(bytes)) },
  ];
}

export function uuid(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = random(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// A Unix timestamp (seconds or milliseconds) or a date, in every form.
export function timestamp(input: string, now = Date.now()): { name: string; value: string }[] {
  const t = input.trim();
  let ms: number;
  if (!t) ms = now;
  else if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    // Ten digits or fewer is seconds; more is milliseconds.
    ms = Math.abs(n) < 1e11 ? n * 1000 : n;
  } else {
    ms = Date.parse(t);
    if (Number.isNaN(ms)) throw new Error('Not a date or a Unix timestamp.');
  }
  const d = new Date(ms);
  return [
    { name: 'Unix seconds', value: String(Math.floor(ms / 1000)) },
    { name: 'Unix milliseconds', value: String(Math.round(ms)) },
    { name: 'ISO 8601 (UTC)', value: d.toISOString() },
    { name: 'Local', value: d.toString() },
  ];
}

export interface RegexMatch {
  index: number;
  text: string;
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export const MAX_MATCHES = 500;

// Every match of `pattern` in `subject`, with its groups.
export function testRegex(pattern: string, flags: string, subject: string): RegexMatch[] {
  if (!pattern) return [];
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
  } catch (e) {
    throw new Error((e as Error).message.replace(/^Invalid regular expression: /, ''));
  }
  const out: RegexMatch[] = [];
  for (const m of subject.matchAll(re)) {
    out.push({ index: m.index ?? 0, text: m[0], groups: m.slice(1), named: { ...(m.groups ?? {}) } });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

// As a JavaScript literal, for pasting into code.
export const regexLiteral = (pattern: string, flags: string) => `/${pattern.replace(/(^|[^\\])\//g, '$1\\/')}/${flags}`;
