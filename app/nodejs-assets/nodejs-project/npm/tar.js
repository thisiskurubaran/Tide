// @ts-check
// Minimal reader for npm tarballs (ustar with pax or GNU long names). Only
// regular files and directories are written; links are skipped on purpose.
'use strict';

const fs = require('fs');
const path = require('path');

function field(buf, start, len) {
  const end = buf.indexOf(0, start);
  return buf.toString('utf8', start, end === -1 || end > start + len ? start + len : end);
}

function octal(buf, start, len) {
  const text = field(buf, start, len).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Parses "len key=value\n" records from a pax header. */
function pax(data) {
  /** @type {Record<string, string>} */
  const out = {};
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space === -1) break;
    const len = parseInt(data.toString('utf8', i, space), 10);
    if (!len) break;
    const record = data.toString('utf8', space + 1, i + len - 1);
    const eq = record.indexOf('=');
    if (eq !== -1) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Extracts an (already gunzipped) tar buffer into `dest`, dropping the first
 * path component (npm tarballs wrap everything in "package/").
 * @returns {string[]} relative paths of the files written
 */
function extract(tar, dest) {
  const written = [];
  let offset = 0;
  /** @type {string | null} */
  let longName = null;
  /** @type {Record<string, string>} */
  let paxHeader = {};
  const root = path.resolve(dest);

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = field(header, 345, 155);
    let name = field(header, 0, 100);
    if (prefix) name = `${prefix}/${name}`;
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      paxHeader = pax(body);
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') {
      longName = body.toString('utf8').replace(/\0+$/, '');
      continue;
    }
    if (paxHeader.path) name = paxHeader.path;
    if (longName) name = longName;
    paxHeader = {};
    longName = null;

    const rel = name.split('/').slice(1).join('/');
    if (!rel) continue;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) continue;

    if (type === '5') {
      fs.mkdirSync(target, { recursive: true });
    } else if (type === '0' || type === '7') {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      written.push(rel);
    }
  }
  return written;
}

module.exports = { extract };
