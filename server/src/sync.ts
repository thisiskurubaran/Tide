import crypto from 'node:crypto';
import readline from 'node:readline';

import type { WebSocket } from 'ws';

import type { SyncInit, SyncToApp, SyncToServer } from '../../shared/protocol.ts';
import { safePath, WORKSPACE } from './paths.ts';
import { WATCHER, type Session, type SessionManager } from './sessions.ts';
import { isSyncSkipped } from './syncRules.ts';

// Content hash used everywhere on the server and by the watcher's snapshot: sha1 of the bytes.
export const hashBytes = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex');

export const CONFLICT_SUFFIX = '.phone-conflict';
// Paths per exec when reading container files to send to the app, and per rm.
const READ_CHUNK = 32;
const RM_CHUNK = 256;
// Hashes kept per path for echo suppression (writes the watcher hasn't seen yet).
const MAX_ECHOES = 8;

// What watcher.py prints (server-internal; 'file' and 'delete' are forwarded).
type WatcherMsg =
  | { type: 'snapshot'; files: Record<string, [string, number]>; owned: string[] }
  | { type: 'file'; path: string; data: string; mode?: number }
  | { type: 'delete'; path: string }
  | { type: 'skipped'; path: string }
  | { type: 'ports'; ports: number[] };

export type Resolution = 'same' | 'phone' | 'container' | 'conflict' | 'delete-phone';

// Three-way decision for a path the app sent in its init. `agreed` is the hash
// both sides last agreed on, `container` the container's hash now (undefined:
// no such file), `phone` the hash of what the app sent. `first` is a session's
// first init, when there is no record yet: the phone wins.
export function resolveInit(first: boolean, agreed: string | undefined, container: string | undefined, phone: string): Resolution {
  if (container === phone) return 'same';
  if (first) return 'phone';
  // Gone from the container: deleted there if the phone didn't change it, otherwise the phone's edit is kept.
  if (container === undefined) return agreed === phone ? 'delete-phone' : 'phone';
  if (agreed === container) return 'phone';
  if (agreed === phone) return 'container';
  // Both changed (or both created it): keep both.
  return 'conflict';
}

type InitState = {
  first: boolean;
  // The container's files (hash) from the watcher's snapshot, kept current by its events.
  container: Map<string, string>;
  // Paths the init covered, including conflict copies written for it.
  seen: Set<string>;
  // Paths whose container copy the app must get (container won, or a conflict).
  toApp: Set<string>;
  deleteOnApp: Set<string>;
  conflicts: { path: string; data: string; hash: string }[];
  // Watcher reports that arrived during the init, delivered after it.
  later: (() => void)[];
};

// Two-way file sync for one connection. The app sends the project once
// ("init", in flow-controlled batches) and then each saved file; a watcher in the container reports files
// created or changed there (npm install output, generated files, edits in vim).
export function attachSync(manager: SessionManager, session: Session, ws: WebSocket, touch: () => void) {
  const send = (msg: SyncToApp) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  // What the container has as far as this connection knows, so a file the app
  // just pushed isn't echoed back and one the watcher reported isn't sent twice.
  const known = new Map<string, string>();
  // Hashes this connection wrote from the app that the watcher may still report
  // (a read between two quick writes sees the older one): never sent back.
  const echoes = new Map<string, Set<string>>();
  // Files and deletes sent to the app and not yet acknowledged, in order.
  const unacked: { path: string; hash: string | null }[] = [];
  let watcher: { stop(): void } | null = null;
  let chain = Promise.resolve();
  let closed = false;
  let init: InitState | null = null;
  let initDone = false;

  // The container owns oversize files and symlinks, and everything under a folder symlink.
  const containerOwned = (path: string) => {
    if (session.skipped.has(path)) return true;
    for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) if (session.skipped.has(path.slice(0, i))) return true;
    return false;
  };

  // Paths the app may write or delete. Container-owned ones are not: the app's
  // copy is older (it never got the big one), so overwriting would lose work.
  const writable = (path: string) => {
    if (isSyncSkipped(path)) return false;
    if (!containerOwned(path)) return true;
    known.delete(path);
    send({ type: 'skipped', path });
    return false;
  };

  const addEcho = (path: string, hash: string) => {
    const set = echoes.get(path) ?? new Set<string>();
    set.delete(hash);
    set.add(hash);
    if (set.size > MAX_ECHOES) set.delete(set.values().next().value!);
    echoes.set(path, set);
  };

  const write = async (files: { path: string; data: Buffer; hash: string }[]) => {
    for (const f of files) {
      known.set(f.path, f.hash);
      addEcho(f.path, f.hash);
    }
    await manager.writeFiles(
      session,
      files.map((f) => ({ path: f.path, data: f.data, mode: session.modes.get(f.path) })),
    );
  };

  const remove = async (paths: string[]) => {
    for (const p of paths) {
      known.delete(p);
      session.modes.delete(p);
    }
    for (let i = 0; i < paths.length; i += RM_CHUNK) {
      await manager.run(session, ['rm', '-rf', '--', ...paths.slice(i, i + RM_CHUNK).map((p) => `${WORKSPACE}/${p}`)]);
    }
  };

  const sendFile = (path: string, data: string, hash: string) => {
    known.set(path, hash);
    unacked.push({ path, hash });
    send({ type: 'file', path, data });
  };

  const sendDelete = (path: string) => {
    known.delete(path);
    unacked.push({ path, hash: null });
    send({ type: 'delete', path });
  };

  const deliverFile = (path: string, data: string, hash: string) => {
    if (known.get(path) === hash) return;
    echoes.delete(path);
    sendFile(path, data, hash);
  };

  const deliverDelete = (path: string, wasSkipped: boolean) => {
    if (!known.has(path) && !wasSkipped) return;
    sendDelete(path);
  };

  const onWatcher = (msg: WatcherMsg) => {
    switch (msg.type) {
      case 'ports':
        session.ports = msg.ports;
        send(msg);
        return;
      case 'skipped':
        session.skipped.add(msg.path);
        known.delete(msg.path);
        init?.container.delete(msg.path);
        send(msg);
        return;
      case 'file': {
        const { path, data } = msg;
        session.skipped.delete(path);
        if (msg.mode !== undefined) session.modes.set(path, msg.mode);
        const hash = hashBytes(Buffer.from(data, 'base64'));
        init?.container.set(path, hash);
        const mine = echoes.get(path);
        if (mine?.has(hash)) {
          // Our own write. If it's an older one, a newer write is on its way
          // and the watcher will see it: the app keeps its newer copy.
          if (known.get(path) === hash) echoes.delete(path);
          return;
        }
        if (init) init.later.push(() => deliverFile(path, data, hash));
        else deliverFile(path, data, hash);
        return;
      }
      case 'delete': {
        const { path } = msg;
        echoes.delete(path);
        session.modes.delete(path);
        const wasSkipped = session.skipped.delete(path);
        if (init) {
          init.container.delete(path);
          init.later.push(() => deliverDelete(path, wasSkipped));
        } else deliverDelete(path, wasSkipped);
        return;
      }
    }
  };

  // Starts the watcher and resolves once its snapshot is in `state`. Lines are
  // handled synchronously, so no report after the snapshot can slip past `init`.
  const startWatcher = (state: InitState) =>
    new Promise<void>((resolve, reject) => {
      manager.spawn(session, ['python3', '-u', '-c', WATCHER]).then((proc) => {
        watcher = proc;
        if (closed) proc.stop();
        let snapshot = false;
        const lines = readline.createInterface({ input: proc.stdout });
        lines.on('line', (line) => {
          let msg: WatcherMsg;
          try {
            msg = JSON.parse(line);
          } catch {
            return;
          }
          if (msg.type === 'snapshot') {
            if (snapshot) return;
            snapshot = true;
            session.skipped.clear();
            for (const p of msg.owned) session.skipped.add(p);
            session.modes.clear();
            for (const [p, [hash, mode]] of Object.entries(msg.files)) {
              state.container.set(p, hash);
              session.modes.set(p, mode);
            }
            resolve();
          } else if (snapshot) onWatcher(msg);
        });
        lines.on('close', () => !snapshot && reject(new Error('file watcher exited')));
      }, reject);
    });

  // Reads container files and sends them to the app.
  const sendFromContainer = async (state: InitState, paths: string[]) => {
    for (let i = 0; i < paths.length; i += READ_CHUNK) {
      const out = await manager.output(session, ['python3', '-c', WATCHER, '--read', ...paths.slice(i, i + READ_CHUNK)]);
      for (const line of out.split('\n')) {
        let msg: WatcherMsg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'file') {
          if (msg.mode !== undefined) session.modes.set(msg.path, msg.mode);
          sendFile(msg.path, msg.data, hashBytes(Buffer.from(msg.data, 'base64')));
        } else if (msg.type === 'skipped') {
          session.skipped.add(msg.path);
          send(msg);
        } else if (msg.type === 'delete' && state.seen.has(msg.path)) {
          // Deleted in the container since: the app's copy goes too.
          sendDelete(msg.path);
        }
      }
    }
  };

  const conflictName = (state: InitState, path: string) => {
    for (let n = 1; ; n++) {
      const name = `${path}${CONFLICT_SUFFIX}${n > 1 ? `-${n}` : ''}`;
      if (!state.container.has(name) && !state.seen.has(name)) return name;
    }
  };

  const handleInit = async (msg: SyncInit) => {
    if (initDone) {
      // A second init on one connection (the app doesn't send one): plain writes.
      for (const f of msg.files) await handle({ type: 'file', path: f.path, data: f.data });
      send(msg.more ? { type: 'init-ack' } : { type: 'ready' });
      return;
    }
    if (!init) {
      const first = !session.agreed;
      init = { first, container: new Map(), seen: new Set(), toApp: new Set(), deleteOnApp: new Set(), conflicts: [], later: [] };
      await startWatcher(init);
      session.agreed ??= new Map();
    }
    const state = init;
    const agreed = session.agreed!;
    const writes: { path: string; data: Buffer; hash: string }[] = [];
    for (const f of msg.files) {
      const path = safePath(f.path);
      if (!writable(path)) continue;
      state.seen.add(path);
      const data = Buffer.from(f.data, 'base64');
      const hash = hashBytes(data);
      const container = state.container.get(path);
      switch (resolveInit(state.first, agreed.get(path), container, hash)) {
        case 'same':
          // Unchanged content isn't rewritten (keeps mtimes, so dev servers don't restart).
          known.set(path, hash);
          agreed.set(path, hash);
          break;
        case 'phone':
          writes.push({ path, data, hash });
          agreed.set(path, hash);
          break;
        case 'container':
          known.set(path, container!);
          state.toApp.add(path);
          break;
        case 'delete-phone':
          state.deleteOnApp.add(path);
          break;
        case 'conflict': {
          // The container's file keeps its name; the phone's version is kept next to it.
          const copy = conflictName(state, path);
          state.seen.add(copy);
          const mode = session.modes.get(path);
          if (mode !== undefined) session.modes.set(copy, mode);
          writes.push({ path: copy, data, hash });
          state.conflicts.push({ path: copy, data: f.data, hash });
          known.set(path, container!);
          state.toApp.add(path);
          break;
        }
      }
    }
    await write(writes);
    if (msg.more) {
      send({ type: 'init-ack' });
      return;
    }

    // Container files the init didn't cover.
    const removeHere: string[] = [];
    for (const [path, hash] of state.container) {
      if (state.seen.has(path) || containerOwned(path) || isSyncSkipped(path)) continue;
      if (!state.first && agreed.get(path) === hash) {
        // The phone deleted it while disconnected and the container didn't touch it.
        removeHere.push(path);
        agreed.delete(path);
      } else state.toApp.add(path); // New (or changed) in the container.
    }
    await remove(removeHere);
    for (const c of state.conflicts) sendFile(c.path, c.data, c.hash);
    await sendFromContainer(state, [...state.toApp]);
    for (const path of state.deleteOnApp) sendDelete(path);
    init = null;
    initDone = true;
    for (const deliver of state.later) deliver();
    send({ type: 'ready' });
  };

  const handle = async (msg: SyncToServer): Promise<void> => {
    touch();
    switch (msg.type) {
      case 'init':
        return handleInit(msg);
      case 'file': {
        const path = safePath(msg.path);
        if (!writable(path)) return;
        const data = Buffer.from(msg.data, 'base64');
        const hash = hashBytes(data);
        session.agreed?.set(path, hash);
        await write([{ path, data, hash }]);
        return;
      }
      case 'delete': {
        const path = safePath(msg.path);
        if (!writable(path)) return;
        session.agreed?.delete(path);
        await remove([path]);
        return;
      }
      case 'ack': {
        const i = unacked.findIndex((u) => u.path === msg.path);
        if (i === -1) return;
        const [{ path, hash }] = unacked.splice(i, 1);
        const agreed = session.agreed;
        if (!agreed) return;
        if (hash !== null) {
          // The app stored it, or couldn't: then it has no copy to agree on, so a
          // later init won't read its absence as a delete.
          if (msg.ok) agreed.set(path, hash);
          else agreed.delete(path);
        } else if (msg.ok) agreed.delete(path);
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
