// The sqlite3 command: run SQL against a database file in the project, once
// (`sqlite3 app.db "SELECT ..."`) or at a sqlite> prompt. The database comes
// from the host (expo-sqlite in the app), so this file has no native code.
import type { Db, QueryResult } from '../../database/database';
import { listTables, runSql } from '../../database/database';
import { visibleLength } from './ansi';

export interface SqliteHost {
  // `path` is relative to the project.
  open(path: string): Promise<Db>;
}

export interface SqliteOutput {
  headers: boolean;
  mode: 'table' | 'list' | 'csv';
}

const MAX_WIDTH = 40;
const cell = (v: unknown) => (v === null || v === undefined ? 'NULL' : v instanceof Uint8Array ? `<blob ${v.length} bytes>` : String(v));
const clip = (s: string) => {
  const one = s.replace(/\r?\n/g, '⏎');
  return one.length > MAX_WIDTH ? `${one.slice(0, MAX_WIDTH - 1)}…` : one;
};
const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function formatResult(result: QueryResult, out: SqliteOutput): string {
  if (result.kind === 'done') return '';
  if (result.kind === 'changes') return `${result.changes} ${result.changes === 1 ? 'row' : 'rows'} changed\n`;
  const { columns, rows } = result;
  if (!rows.length) return '';
  const values = rows.map((r) => columns.map((c) => cell(r[c])));
  if (out.mode === 'csv') return [...(out.headers ? [columns] : []), ...values].map((r) => r.map(csvField).join(',')).join('\n') + '\n';
  if (out.mode === 'list') return [...(out.headers ? [columns] : []), ...values].map((r) => r.join('|')).join('\n') + '\n';
  const shown = values.map((r) => r.map(clip));
  const widths = columns.map((c, i) => Math.max(out.headers ? visibleLength(c) : 0, ...shown.map((r) => visibleLength(r[i]))));
  const line = (l: string, m: string, r: string) => `${l}${widths.map((w) => '─'.repeat(w + 2)).join(m)}${r}\n`;
  const row = (r: string[]) => `│ ${r.map((v, i) => v + ' '.repeat(widths[i] - visibleLength(v))).join(' │ ')} │\n`;
  return line('┌', '┬', '┐') + (out.headers ? row(columns) + line('├', '┼', '┤') : '') + shown.map(row).join('') + line('└', '┴', '┘');
}

export const SQLITE_HELP = `.tables            list tables and views
.schema [table]    show CREATE statements
.headers on|off    column names in results
.mode table|list|csv
.quit              leave sqlite3 (Ctrl-D works too)
End SQL with ; to run it; it can span lines.
`;

// Dot commands at the sqlite> prompt. Returns the text to print, or null to quit.
export async function dotCommand(db: Db, line: string, out: SqliteOutput): Promise<string | null> {
  const [cmd, arg] = line.trim().split(/\s+/);
  switch (cmd) {
    case '.quit':
    case '.exit':
      return null;
    case '.help':
      return SQLITE_HELP;
    case '.tables':
      return (await listTables(db)).map((t) => t.name).join('  ') + '\n';
    case '.schema': {
      const rows = await db.getAllAsync<{ sql: string | null }>(
        `SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'${arg ? ' AND tbl_name = ?' : ''} ORDER BY type, name`,
        ...(arg ? [arg] : []),
      );
      return rows.map((r) => `${r.sql};`).join('\n') + (rows.length ? '\n' : '');
    }
    case '.headers':
      out.headers = arg !== 'off';
      return '';
    case '.mode':
      if (arg !== 'table' && arg !== 'list' && arg !== 'csv') return 'Modes: table, list, csv\n';
      out.mode = arg;
      return '';
    default:
      return `Unknown command ${cmd}. Type .help for the list.\n`;
  }
}

// A statement is complete once it ends with ; outside quotes and comments.
export function isComplete(sql: string): boolean {
  const code = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
  return /;\s*$/.test(code);
}

export { runSql };
