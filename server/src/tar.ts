// Writes ustar archives for docker putArchive. Entries are owned by uid/gid
// 1000 (the container's tide user) so the shell can edit what the app uploads.
const BLOCK = 512;
const UID = 1000;

function octal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, type: '0' | '5' | 'x') {
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(type === '5' ? 0o755 : 0o644, 8), 100);
  h.write(octal(UID, 8), 108);
  h.write(octal(UID, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(Date.now() / 1000), 12), 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + ' ', 148);
  return h;
}

const pad = (n: number) => Buffer.alloc((BLOCK - (n % BLOCK)) % BLOCK);

function entry(name: string, data: Buffer, type: '0' | '5'): Buffer[] {
  const out: Buffer[] = [];
  if (Buffer.byteLength(name) > 99) {
    // pax extended header carries names longer than the 100-byte field.
    const record = (len: number) => `${len} path=${name}\n`;
    let len = Buffer.byteLength(record(0));
    while (Buffer.byteLength(record(len)) !== len) len = Buffer.byteLength(record(len));
    const pax = Buffer.from(record(len));
    out.push(header('PaxHeader', pax.length, 'x'), pax, pad(pax.length));
  }
  out.push(header(Buffer.byteLength(name) > 99 ? name.slice(0, 99) : name, data.length, type), data, pad(data.length));
  return out;
}

export function packTar(files: { path: string; data: Buffer }[]): Buffer {
  const dirs = new Set<string>();
  const parts: Buffer[] = [];
  for (const file of files) {
    const segments = file.path.split('/');
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/');
      if (dirs.has(dir)) continue;
      dirs.add(dir);
      parts.push(...entry(`${dir}/`, Buffer.alloc(0), '5'));
    }
    parts.push(...entry(file.path, file.data, '0'));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}
