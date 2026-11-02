/**
 * @jest-environment node
 */
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { readParquet } from './parquet';
import { columnStats, detectDelimiter, filterRows, groupBy, isNumeric, parseCsv, sortRows, toNumber } from './table';

const CSV = 'city,sales,note\r\nChennai,120,"big, early"\nPune,80,"said ""hi"""\nChennai,30,\nDelhi,1,"two\nlines"\n';

describe('CSV tables', () => {
  it('parses quotes, escaped quotes, embedded newlines and CRLF', () => {
    const t = parseCsv(CSV);
    expect(t.columns).toEqual(['city', 'sales', 'note']);
    expect(t.rows).toEqual([
      ['Chennai', '120', 'big, early'],
      ['Pune', '80', 'said "hi"'],
      ['Chennai', '30', ''],
      ['Delhi', '1', 'two\nlines'],
    ]);
    expect(t.truncated).toBe(false);
  });

  it('detects tabs and semicolons, pads short rows and names blank headers', () => {
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectDelimiter('a;b\n1,5;2')).toBe(';');
    const t = parseCsv('a;;c\n1;2\n');
    expect(t.columns).toEqual(['a', 'Column 2', 'c']);
    expect(t.rows).toEqual([['1', '2', '']]);
  });

  it('stops at the row limit and says so', () => {
    const t = parseCsv('n\n1\n2\n3\n4\n', { maxRows: 2 });
    expect(t.rows).toEqual([['1'], ['2']]);
    expect(t.truncated).toBe(true);
  });

  it('sorts numbers as numbers, text naturally, with empty cells last', () => {
    const t = parseCsv('name,n\nb,10\na,9\n,\nc,100\n');
    expect(isNumeric(t, 1)).toBe(true);
    expect(sortRows(t, 1, 'asc').map((r) => r[1])).toEqual(['9', '10', '100', '']);
    expect(sortRows(t, 1, 'desc').map((r) => r[1])).toEqual(['100', '10', '9', '']);
    expect(sortRows(t, 0, 'asc').map((r) => r[0])).toEqual(['a', 'b', 'c', '']);
    expect(toNumber('1,234.5')).toBe(1234.5);
    expect(toNumber('abc')).toBeNull();
  });

  it('filters by words and by column:value', () => {
    const t = parseCsv(CSV);
    expect(filterRows(t, t.rows, 'chennai').length).toBe(2);
    expect(filterRows(t, t.rows, 'chennai big').length).toBe(1);
    expect(filterRows(t, t.rows, 'note:hi').map((r) => r[0])).toEqual(['Pune']);
  });

  it('works out column stats and grouped values for charts', () => {
    const t = parseCsv(CSV);
    expect(columnStats(t, 1)).toMatchObject({ numeric: true, min: 1, max: 120, sum: 231, distinct: 4 });
    expect(columnStats(t, 0).top?.[0]).toEqual({ value: 'Chennai', count: 2 });
    expect(groupBy(t.rows, 0, 1, 'sum')).toEqual([
      { label: 'Chennai', value: 150 },
      { label: 'Pune', value: 80 },
      { label: 'Delhi', value: 1 },
    ]);
    expect(groupBy(t.rows, 0, null, 'count')[0]).toEqual({ label: 'Chennai', value: 2 });
    expect(groupBy(t.rows, 0, 1, 'mean')[0]).toEqual({ label: 'Pune', value: 80 });
  });
});

describe('Parquet tables', () => {
  const buffer = (f: string) => {
    const b = fs.readFileSync(f);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  };

  it('reads a snappy Parquet file, with int64, nulls and dates as text', async () => {
    const t = await readParquet(buffer(path.join(__dirname, '__fixtures__/sample.parquet')));
    expect(t.columns).toEqual(['city', 'sales', 'price', 'day']);
    expect(t.rows[0]).toEqual(['Chennai', '120', '1.5', '2026-01-01T00:00:00.000Z']);
    expect(t.rows[2][2]).toBe('');
    expect(t.truncated).toBe(false);
    const cut = await readParquet(buffer(path.join(__dirname, '__fixtures__/sample.parquet')), 2);
    expect(cut.rows).toHaveLength(2);
    expect(cut.truncated).toBe(true);
  });
});
