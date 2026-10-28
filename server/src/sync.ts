import crypto from 'node:crypto';
import readline from 'node:readline';

import type { WebSocket } from 'ws';

import type { SyncToApp, SyncToServer } from '../../shared/protocol.ts';
import { safePath, WORKSPACE } from './paths.ts';
import { WATCHER, type Session, type SessionManager } from './sessions.ts';

const hash = (data: string) => crypto.createHash('sha1').update(data).digest('hex');

// Two-way file sync for one connection. The app sends the project once
// ("init") and then each saved file; a watcher in the container reports files
// created or changed there (npm install output, generated files, edits in vim).
export function attachSync(manager: SessionManager, session: Session, ws: WebSocket, touch: () => void) {
  const send = (msg: SyncToApp) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  // Last content each side agreed on, so a file the app just pushed isn't echoed back.
  const known = new Map<string, string>();
  let watcher: { stop(): void } | null = null;
  let chain = Promise.resolve();

  const startWatcher = async () => {
    const proc = await manager.spawn(session, ['python3', '-u', '-c', WATCHER]);
    watcher = proc;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg: SyncToApp;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'ports') {
        session.ports = msg.ports;
        send(msg);
      } else if (msg.type === 'file') {
        const h = hash(msg.data);
        if (known.get(msg.path) === h) return;
        known.set(msg.path, h);
        send(msg);
      } else if (msg.type === 'delete') {
        if (!known.has(msg.path)) return;
        known.delete(msg.path);
        send(msg);
      }
    });
  };

  const handle = async (msg: SyncToServer) => {
    touch();
    switch (msg.type) {
      case 'init': {
        const files = msg.files.map((f) => ({ path: safePath(f.path), data: Buffer.from(f.data, 'base64') }));
        for (const f of msg.files) known.set(safePath(f.path), hash(f.data));
        await manager.writeFiles(session, files);
        if (!watcher) await startWatcher();
        send({ type: 'ready' });
        return;
      }
      case 'file': {
        const path = safePath(msg.path);
        known.set(path, hash(msg.data));
        await manager.writeFiles(session, [{ path, data: Buffer.from(msg.data, 'base64') }]);
        return;
      }
      case 'delete': {
        const path = safePath(msg.path);
        known.delete(path);
        await manager.run(session, ['rm', '-rf', '--', `${WORKSPACE}/${path}`]);
        return;
      }
    }
  };

  ws.on('message', (raw) => {
    let msg: SyncToServer;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    // Apply in order: a delete must not overtake the write before it.
    chain = chain.then(() => handle(msg)).catch((e: Error) => ws.close(1011, e.message.slice(0, 100)));
  });
  ws.on('close', () => watcher?.stop());
}
