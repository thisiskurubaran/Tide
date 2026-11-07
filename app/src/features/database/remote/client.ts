import type { Runner } from '../../../runtime/runner';
import { connectLines } from './lines';

export interface SqlResult {
  columns: string[];
  // Values as the server's text, or null.
  rows: (string | null)[][];
  rowCount: number | null;
  command: string | null;
  hasRows: boolean;
}

export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<SqlResult>;
  close(): Promise<void>;
}

export interface ServerConfig {
  kind: 'postgres' | 'mysql';
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  ssl: 'off' | 'require' | 'verify';
}

// A connection held open by tide:sql in the Node runtime: one JSON request per
// stdin line, one JSON reply per stdout line.
export async function connectSql(runner: Runner, config: ServerConfig): Promise<SqlClient & { version: string }> {
  const lines = await connectLines(runner, 'tide:sql', { TIDE_SQL: JSON.stringify(config) });
  return {
    version: lines.version,
    query: (sql, params = []) => lines.request<SqlResult>({ sql, params }),
    close: () => lines.close(),
  };
}
