import type { RunnerMessage } from '@shared/protocol';

import type { Runner } from '../../../runtime/runner';

export interface LineClient {
  // Sends {id, ...body} and resolves with the reply that has that id and ok: true.
  request<T = any>(body: object): Promise<T>;
  close(): Promise<void>;
}

let next = 0;

// A connection held open by a tide:<service> in the Node runtime (sql, redis,
// mongo): it prints {"type":"ready", ...} once connected, then answers each
// JSON request line with a JSON reply line carrying the request's id.
export function connectLines(runner: Runner, entry: string, env: Record<string, string>): Promise<LineClient & { version: string }> {
  const id = `${entry.replace(/^tide:/, '')}-${Date.now()}-${++next}`;
  const waiting = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buffer = '';
  let stderr = '';
  let closed = false;

  return new Promise((resolve, reject) => {
    const client: LineClient = {
      request(body) {
        if (closed) return Promise.reject(new Error('The connection closed. Go back and connect again.'));
        const n = ++seq;
        return new Promise((res, rej) => {
          waiting.set(n, { resolve: res, reject: rej });
          runner.send({ type: 'stdin', id, data: `${JSON.stringify({ ...body, id: n })}\n` });
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        runner.send({ type: 'stdin', id, data: '{"op":"close"}\n' });
        setTimeout(() => runner.send({ type: 'kill', id }), 2000);
      },
    };
    runner.run({ type: 'run', id, runtime: 'node', entry, cwd: '', args: [], env, limits: { timeoutMs: 0 } }, (msg: RunnerMessage) => {
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
          if (reply.ok) w.resolve(reply);
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
