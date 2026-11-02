// Parquet files as tables, read with hyparquet (pure JS). Snappy-compressed
// and uncompressed files read; other codecs (gzip, zstd, brotli) don't.
import { parquetMetadata, parquetReadObjects } from 'hyparquet';

import { MAX_ROWS, Table } from './table';

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  return String(v);
};

export async function readParquet(buffer: ArrayBuffer, maxRows = MAX_ROWS): Promise<Table> {
  const meta = parquetMetadata(buffer);
  const total = Number(meta.num_rows);
  const rows = await parquetReadObjects({ file: buffer, metadata: meta, rowEnd: Math.min(total, maxRows) });
  const columns = rows.length ? Object.keys(rows[0]) : meta.schema.slice(1).map((s) => s.name);
  return { columns, rows: rows.map((r) => columns.map((c) => cell(r[c]))), truncated: total > maxRows };
}
