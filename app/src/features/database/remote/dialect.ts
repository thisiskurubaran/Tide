// Postgres and MySQL behind the database viewer. The SQL differs in quoting,
// placeholders and where table details live; the rest is shared.
import { ForeignKey, parseValue, QueryResult, Row, ROWID, SchemaTable, TableInfo, PAGE_SIZE } from '../database';
import type { DbSource, Page } from '../source';
import type { SqlClient, SqlResult } from './client';

export type SqlKind = 'postgres' | 'mysql';

interface TableRef {
  schema: string | null;
  name: string;
  kind: 'table' | 'view';
}

const toRows = (r: SqlResult): Row[] => r.rows.map((values) => Object.fromEntries(r.columns.map((c, i) => [c, values[i]])));

export function remoteSource(client: SqlClient, kind: SqlKind): DbSource {
  const pg = kind === 'postgres';
  const quote = (id: string) => (pg ? `"${id.replace(/"/g, '""')}"` : `\`${id.replace(/`/g, '``')}\``);
  const p = (i: number) => (pg ? `$${i}` : '?');
  const refs = new Map<string, TableRef>();
  const keys = new Map<string, { columns: string[]; primary: string[] }>();

  const ref = (table: string) => {
    const r = refs.get(table);
    if (!r) throw new Error(`There's no table ${table}.`);
    return r;
  };
  const qualified = (table: string) => {
    const r = ref(table);
    return r.schema && pg ? `${quote(r.schema)}.${quote(r.name)}` : quote(r.name);
  };

  async function info(table: string) {
    const cached = keys.get(table);
    if (cached) return cached;
    const r = ref(table);
    const cols = pg
      ? await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position', [r.schema, r.name])
      : await client.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [r.name]);
    const pk =
      r.kind === 'view'
        ? null
        : pg
          ? await client.query(
              'SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)',
              [qualified(table)],
            )
          : await client.query(
              "SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
              [r.name],
            );
    const out = { columns: cols.rows.map((x) => x[0]!), primary: pk ? pk.rows.map((x) => x[0]!) : [] };
    keys.set(table, out);
    return out;
  }

  // WHERE for one row by its primary key, with placeholders from `start`.
  const byKey = (primary: string[], start: number) => primary.map((c, i) => `${quote(c)} = ${p(start + i)}`).join(' AND ');
  const keyOf = (row: Row) => {
    const key = row[ROWID];
    if (!Array.isArray(key)) throw new Error('This row has no primary key to find it by.');
    return key as unknown[];
  };
  const changedOne = (r: SqlResult) => {
    if (r.rowCount === 0) throw new Error('That row is gone or its key changed. Pull down to reload.');
  };

  return {
    async listTables(): Promise<TableInfo[]> {
      const r = pg
        ? await client.query(
            `SELECT n.nspname, c.relname, CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END,
                    CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
              ORDER BY n.nspname <> 'public', n.nspname, 3, c.relname`,
          )
        : await client.query(
            "SELECT NULL, TABLE_NAME, IF(TABLE_TYPE = 'VIEW', 'view', 'table'), TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY 3, TABLE_NAME",
          );
      refs.clear();
      keys.clear();
      return r.rows.map(([schema, name, k, rows]) => {
        // Tables outside public are shown with their schema.
        const display = pg && schema !== 'public' ? `${schema}.${name}` : name!;
        refs.set(display, { schema, name: name!, kind: k === 'view' ? 'view' : 'table' });
        // The servers' counts are estimates.
        return { name: display, kind: k === 'view' ? 'view' : 'table', rows: rows === null ? null : Number(rows) };
      });
    },

    async page(table, offset): Promise<Page> {
      const { columns, primary } = await info(table);
      const order = primary.length ? ` ORDER BY ${primary.map(quote).join(', ')}` : '';
      const r = await client.query(`SELECT * FROM ${qualified(table)}${order} LIMIT ${PAGE_SIZE} OFFSET ${Math.max(0, Math.floor(offset))}`);
      const rows = toRows(r);
      if (primary.length) for (const row of rows) row[ROWID] = primary.map((c) => row[c]);
      return { columns: r.columns.length ? r.columns : columns, rows, editable: primary.length > 0 };
    },

    async updateCell(table, row, column, text) {
      const { primary } = await info(table);
      changedOne(await client.query(`UPDATE ${qualified(table)} SET ${quote(column)} = ${p(1)} WHERE ${byKey(primary, 2)}`, [parseValue(text), ...keyOf(row)]));
    },

    async deleteRow(table, row) {
      const { primary } = await info(table);
      changedOne(await client.query(`DELETE FROM ${qualified(table)} WHERE ${byKey(primary, 1)}`, keyOf(row)));
    },

    async insertRow(table, values) {
      const set = Object.entries(values).filter(([, v]) => v !== '');
      if (!set.length) {
        await client.query(pg ? `INSERT INTO ${qualified(table)} DEFAULT VALUES` : `INSERT INTO ${qualified(table)} () VALUES ()`);
        return;
      }
      await client.query(
        `INSERT INTO ${qualified(table)} (${set.map(([c]) => quote(c)).join(', ')}) VALUES (${set.map((_, i) => p(i + 1)).join(', ')})`,
        set.map(([, v]) => parseValue(v)),
      );
    },

    async allRows(table) {
      const r = await client.query(`SELECT * FROM ${qualified(table)}`);
      return { columns: r.columns, rows: toRows(r) };
    },

    async run(sql): Promise<QueryResult> {
      if (!sql.trim()) return { kind: 'done' };
      const r = await client.query(sql);
      // Schema changes may have changed what's cached.
      keys.clear();
      if (r.hasRows) return { kind: 'rows', columns: r.columns, rows: toRows(r) };
      // MySQL counts 0 changed rows for CREATE and the like; that's just "done".
      const last = sql.split(';').filter((x) => x.trim()).pop() ?? '';
      if (r.rowCount !== null && (r.rowCount > 0 || /^\s*(insert|update|delete|replace|merge)\b/i.test(last))) return { kind: 'changes', changes: r.rowCount };
      return { kind: 'done' };
    },

    async schema(): Promise<SchemaTable[]> {
      const tables = await this.listTables();
      const display = (schema: string | null, name: string) => (pg && schema !== 'public' ? `${schema}.${name}` : name);
      const out = new Map<string, SchemaTable>(tables.map((t) => [t.name, { name: t.name, kind: t.kind, columns: [], foreignKeys: [] }]));
      const cols = pg
        ? await client.query(
            "SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name, ordinal_position",
          )
        : await client.query(
            'SELECT NULL, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION',
          );
      const primary = new Set<string>();
      if (pg) {
        const pk = await client.query(
          "SELECT n.nspname, c.relname, a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisprimary AND n.nspname NOT IN ('pg_catalog', 'information_schema')",
        );
        for (const [s, t, c] of pk.rows) primary.add(`${display(s, t!)}.${c}`);
      }
      for (const [s, t, c, type, nullable, def, key] of cols.rows) {
        const table = out.get(display(s, t!));
        if (!table) continue;
        table.columns.push({ name: c!, type: type ?? '', nullable: nullable === 'YES', primary: pg ? primary.has(`${display(s, t!)}.${c}`) : key === 'PRI', default: def });
      }
      const fks = pg
        ? await client.query(
            `SELECT c.conname, sn.nspname, sr.relname, sa.attname, tn.nspname, tr.relname, ta.attname
               FROM pg_constraint c
               JOIN pg_class sr ON sr.oid = c.conrelid JOIN pg_namespace sn ON sn.oid = sr.relnamespace
               JOIN pg_class tr ON tr.oid = c.confrelid JOIN pg_namespace tn ON tn.oid = tr.relnamespace
               CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY AS k(src, dst, ord)
               JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = k.src
               JOIN pg_attribute ta ON ta.attrelid = c.confrelid AND ta.attnum = k.dst
              WHERE c.contype = 'f' AND sn.nspname NOT IN ('pg_catalog', 'information_schema')
              ORDER BY sn.nspname, sr.relname, c.conname, k.ord`,
          )
        : await client.query(
            'SELECT CONSTRAINT_NAME, NULL, TABLE_NAME, COLUMN_NAME, NULL, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION',
          );
      const byName = new Map<string, { table: string; fk: ForeignKey }>();
      for (const [name, s, t, c, ts, tt, tc] of fks.rows) {
        const from = display(s, t!);
        const key = `${from}:${name}`;
        const entry = byName.get(key) ?? { table: from, fk: { columns: [], table: display(ts, tt!), to: [] } };
        entry.fk.columns.push(c!);
        entry.fk.to.push(tc!);
        byName.set(key, entry);
      }
      for (const { table, fk } of byName.values()) out.get(table)?.foreignKeys.push(fk);
      return [...out.values()];
    },

    close: () => client.close(),
    readOnlyNote: 'Views and tables without a primary key can be changed with SQL.',
    sqlNote: 'Runs on the server right away; there’s no undo.',
    sqlPlaceholder: pg ? 'SELECT * FROM users WHERE created_at > now() - interval \'1 day\'' : 'SELECT * FROM users WHERE created_at > NOW() - INTERVAL 1 DAY',
  };
}
