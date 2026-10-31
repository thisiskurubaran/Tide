import type { RunnerMessage } from '@shared/protocol';

import type { Runner } from '../../../runtime/runner';

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

let next = 0;

// A connection held open by tide:sql in the Node runtime: one JSON request per
// stdin line, one JSON reply per stdout line.
export function connectSql(runner: Runner, config: ServerConfig): Promise<SqlClient & { version: string }> {
  const id = `sql-${Date.now()}-${++next}`;
  const waiting = new Map<number, { resolve: (r: SqlResult) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buffer = '';
  let stderr = '';
  let closed = false;

  return new Promise((resolve, reject) => {
    const client: SqlClient = {
      query(sql, params = []) {
        if (closed) return Promise.reject(new Error('The connection closed. Go back and connect again.'));
        const n = ++seq;
        return new Promise<SqlResult>((res, rej) => {
          waiting.set(n, { resolve: res, reject: rej });
          runner.send({ type: 'stdin', id, data: `${JSON.stringify({ id: n, sql, params })}\n` });
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        runner.send({ type: 'stdin', id, data: '{"op":"close"}\n' });
        setTimeout(() => runner.send({ type: 'kill', id }), 2000);
      },
    };
    runner.run({ type: 'run', id, runtime: 'node', entry: 'tide:sql', cwd: '', args: [], env: { TIDE_SQL: JSON.stringify(config) }, limits: { timeoutMs: 0 } }, (msg: RunnerMessage) => {
      if (msg.type === 'stderr') stderr += msg.data;
      else if (msg.type === 'stdout') {
        buffer += msg.data;
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          let reply: any;
          try {
            reply = JSON.parse(line);
          } catch {
            continue;
          }
          if (reply.type === 'ready') {
            resolve({ ...client, version: reply.version });
            continue;
          }
          const w = waiting.get(reply.id);
          if (!w) continue;
          waiting.delete(reply.id);
          if (reply.ok) w.resolve(reply as SqlResult);
          else w.reject(new Error(reply.error));
        }
      } else if (msg.type === 'exit') {
        closed = true;
        const e = new Error(stderr.trim() || 'The connection closed.');
        reject(e);
        waiting.forEach((w) => w.reject(e));
        waiting.clear();
      }
    });
  });
}
