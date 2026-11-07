import crypto from 'node:crypto';
import readline from 'node:readline';

import type { WebSocket } from 'ws';

import type { SyncToApp, SyncToServer } from '../../shared/protocol.ts';
import { safePath, WORKSPACE } from './paths.ts';
import { WATCHER, type Session, type SessionManager } from './sessions.ts';
import { isSyncSkipped } from './syncRules.ts';

const hash = (data: string) => crypto.createHash('sha1').update(data).digest('hex');

// Two-way file sync for one connection. The app sends the project once
// ("init", in batches) and then each saved file; a watcher in the container reports files
// created or changed there (npm install output, generated files, edits in vim).
export function attachSync(manager: SessionManager, session: Session, ws: WebSocket, touch: () => void) {
  const send = (msg: SyncToApp) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  // Last content each side agreed on, so a file the app just pushed isn't echoed back.
  const known = new Map<string, string>();
  let watcher: { stop(): void } | null = null;
  let chain = Promise.resolve();
  let closed = false;
  let initStarted = false;

  // Paths the app may write. Oversize container files are not: the app's copy
  // is older (it never got the big one), so overwriting would lose work.
  const writable = (path: string) => {
    if (isSyncSkipped(path)) return false;
    if (!session.skipped.has(path)) return true;
    known.delete(path);
    send({ type: 'skipped', path });
    return false;
  };

  const startWatcher = async () => {
    const proc = await manager.spawn(session, ['python3', '-u', '-c', WATCHER]);
    watcher = proc;
    if (closed) proc.stop();
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
      } else if (msg.type === 'skipped') {
        session.skipped.add(msg.path);
        known.delete(msg.path);
        send(msg);
      } else if (msg.type === 'file') {
        session.skipped.delete(msg.path);
        const h = hash(msg.data);
        if (known.get(msg.path) === h) return;
        known.set(msg.path, h);
        send(msg);
      } else if (msg.type === 'delete') {
        const wasSkipped = session.skipped.delete(msg.path);
        if (!known.delete(msg.path) && !wasSkipped) return;
        send(msg);
      }
    });
  };

  const handle = async (msg: SyncToServer) => {
    touch();
    switch (msg.type) {
      case 'init': {
        if (!initStarted) {
          initStarted = true;
          // Oversize files may have changed while no watcher was running.
          await refreshSkipped(manager, session);
        }
        const files: { path: string; data: Buffer }[] = [];
        for (const f of msg.files) {
          const path = safePath(f.path);
          if (!writable(path)) continue;
          known.set(path, hash(f.data));
          files.push({ path, data: Buffer.from(f.data, 'base64') });
        }
        await manager.writeFiles(session, files);
        if (msg.more) return;
        if (!watcher) await startWatcher();
        send({ type: 'ready' });
        return;
      }
      case 'file': {
        const path = safePath(msg.path);
        if (!writable(path)) return;
        known.set(path, hash(msg.data));
        await manager.writeFiles(session, [{ path, data: Buffer.from(msg.data, 'base64') }]);
        return;
      }
      case 'delete': {
        const path = safePath(msg.path);
        if (!writable(path)) return;
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
  ws.on('close', () => {
    closed = true;
    watcher?.stop();
  });
}

// Replaces the session's oversize list with what is in the container now.
export async function refreshSkipped(manager: Pick<SessionManager, 'output'>, session: Session) {
  let list: unknown;
  try {
    list = JSON.parse(await manager.output(session, ['python3', '-c', WATCHER, '--oversize']));
  } catch {
    return;
  }
  if (!Array.isArray(list)) return;
  session.skipped.clear();
  for (const p of list) if (typeof p === 'string') session.skipped.add(p);
}
