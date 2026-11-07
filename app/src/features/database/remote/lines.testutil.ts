/// <reference types="node" />
// For tests: runs a tide:<service> program (sql, redis, mongo) with this
// machine's node and talks to it the way connectLines does in the app.
import { spawn } from 'child_process';
import path from 'path';

import type { LineClient } from './lines';

export const cliPath = (service: string) => path.join(__dirname, `../../../../nodejs-assets/nodejs-project/${service}/cli.js`);

export function spawnLines(service: string, env: Record<string, string>, nodeArgs: string[] = []): Promise<LineClient & { version: string }> {
  const child = spawn(process.execPath, [...nodeArgs, cliPath(service)], { env: { ...process.env, ...env } });
  const waiting = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let buffer = '';
  let stderr = '';
  return new Promise((resolve, reject) => {
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', () => {
      const e = new Error(stderr.trim() || 'exited');
      reject(e);
      waiting.forEach((w) => w.reject(e));
    });
    child.stdout.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const reply = JSON.parse(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (reply.type === 'ready') {
          resolve({
            version: reply.version,
            request: (body) =>
              new Promise((res, rej) => {
                const id = ++seq;
                waiting.set(id, { resolve: res, reject: rej });
                child.stdin.write(`${JSON.stringify({ ...body, id })}\n`);
              }),
            close: () =>
              new Promise<void>((res) => {
                child.once('exit', () => res());
                child.stdin.end();
              }),
          });
          continue;
        }
        const w = waiting.get(reply.id)!;
        waiting.delete(reply.id);
        if (reply.ok) w.resolve(reply);
        else w.reject(new Error(reply.error));
      }
    });
  });
}
