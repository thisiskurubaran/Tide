import crypto from 'node:crypto';
import readline from 'node:readline';

import type { WebSocket } from 'ws';

import type { SyncInit, SyncToApp, SyncToServer } from '../../shared/protocol.ts';
import { safePath, WORKSPACE } from './paths.ts';
import { WATCHER, type Session, type SessionManager } from './sessions.ts';
import type { TarFile } from './tar.ts';
import { isSyncSkipped } from './syncRules.ts';

// Content hash used everywhere on the server and by the watcher's snapshot: sha1 of the bytes.
export const hashBytes = (data: Buffer) => crypto.createHash('sha1').update(data).digest('hex');

export const CONFLICT_SUFFIX = '.phone-conflict';
// Paths per exec when reading container files to send to the app, and per rm.
const READ_CHUNK = 32;
const RM_CHUNK = 256;
// Hashes kept per path for echo suppression (writes the watcher hasn't seen
// yet), and for how long: the watcher polls every 0.5s, so a write it hasn't
// reported by then never will be, and a real container file with that content
// must not be hidden.
const MAX_ECHOES = 8;
export const ECHO_TTL_MS = 5000;
// Where conflict copies wait in the container until the init's last batch names them.
const SPILL_DIR = '/tmp';
// How long an app delete of a container-owned file waits for the 'file' that
// would make it a rename (see ownedDeletes in attachSync).
export const RENAME_WINDOW_MS = 1000;

// What watcher.py prints (server-internal; 'file' and 'delete' are forwarded).
type WatcherMsg =
  | { type: 'snapshot'; files: Record<string, [string, number]>; owned: string[] }
  | { type: 'file'; path: string; data: string; mode?: number }
  | { type: 'delete'; path: string }
  | { type: 'skipped'; path: string }
  | { type: 'ports'; ports: number[] };

// The init as the app sends it. `skippedPaths` (optional: older apps don't send
// it) names files the phone has but can't send (over the size limit, or
// unreadable). Their absence from `files` is not a phone-side delete, and the
// container's copy is not sent over them.
export type SyncInitMessage = SyncInit;

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
  // Paths the init covered: every phone path (sent or in skippedPaths) and the conflict copies written for it.
  seen: Set<string>;
  // Phone files the app could not send (skippedPaths): never deleted or overwritten on either side.
  unsent: Set<string>;
  // Paths whose container copy the app must get (container won, or a conflict).
  toApp: Set<string>;
  deleteOnApp: Set<string>;
  // Both sides changed `path`: the phone's version gets a conflict copy. Named
  // only after the last batch, once every phone path is known, so a copy never
  // lands on a path the phone sends later in the init. Until then each batch's
  // copies wait in the container under SPILL_DIR/`spill` (as `tmp`), so their
  // data isn't held in memory across batches.
  conflicts: { path: string; tmp: string; hash: string }[];
  spill: string | null;
  // Watcher reports that arrived during the init, delivered after it unless
  // superseded. `at` orders them against `touched`.
  later: { path: string; at: number; file: { data: string; hash: string } | null; wasSkipped: boolean }[];
  // When the init last wrote, removed, read or sent each path (same clock as `at`).
  touched: Map<string, number>;
  clock: number;
};

// Two-way file sync for one connection. The app sends the project once
// ("init", in flow-controlled batches) and then each saved file; a watcher in the container reports files
// created or changed there (npm install output, generated files, edits in vim).
export function attachSync(
  manager: SessionManager,
  session: Session,
  ws: WebSocket,
  touch: () => void,
  opts: { renameWindowMs?: number; echoTtlMs?: number } = {},
) {
  const renameWindowMs = opts.renameWindowMs ?? RENAME_WINDOW_MS;
  const echoTtlMs = opts.echoTtlMs ?? ECHO_TTL_MS;
  const send = (msg: SyncToApp) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  // What the container has as far as this connection knows, so a file the app
  // just pushed isn't echoed back and one the watcher reported isn't sent twice.
  const known = new Map<string, string>();
  // Hashes this connection wrote from the app that the watcher may still report
  // (a read between two quick writes sees the older one): never sent back.
  // hash -> when it stops counting as an echo.
  const echoes = new Map<string, Map<string, number>>();
  let echoSweep = 0;
  // Files and deletes sent to the app and not yet acknowledged, in order, with
  // the path's appWrites count when sent.
  const unacked: { path: string; hash: string | null; seq: number }[] = [];
  // App writes and deletes per path. An ack whose path the app wrote after it
  // was sent is stale: the app's write is what both sides have.
  const appWrites = new Map<string, number>();
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

  // Paths the app may write (or delete, apart from ownedDeletes below).
  // Container-owned ones are not: the app's copy is older (it never got the big
  // one), so overwriting would lose work.
  const writable = (path: string) => {
    if (isSyncSkipped(path)) return false;
    if (!containerOwned(path)) return true;
    known.delete(path);
    send({ type: 'skipped', path });
    return false;
  };

  const pruneEchoes = (path: string, now: number) => {
    const hashes = echoes.get(path);
    if (!hashes) return;
    for (const [h, until] of hashes) if (until <= now) hashes.delete(h);
    if (!hashes.size) echoes.delete(path);
  };

  const addEcho = (path: string, hash: string) => {
    const now = Date.now();
    if (now - echoSweep > echoTtlMs) {
      echoSweep = now;
      for (const p of [...echoes.keys()]) pruneEchoes(p, now);
    }
    const hashes = echoes.get(path) ?? new Map<string, number>();
    hashes.delete(hash);
    hashes.set(hash, now + echoTtlMs);
    if (hashes.size > MAX_ECHOES) hashes.delete(hashes.keys().next().value!);
    echoes.set(path, hashes);
  };

  const isEcho = (path: string, hash: string) => {
    pruneEchoes(path, Date.now());
    return echoes.get(path)?.has(hash) ?? false;
  };

  // Records that the init acted on `path` now: watcher reports queued before are stale.
  const touchInit = (path: string) => {
    if (init) init.touched.set(path, ++init.clock);
  };

  const write = async (files: { path: string; data: Buffer; hash: string }[]) => {
    for (const f of files) {
      known.set(f.path, f.hash);
      addEcho(f.path, f.hash);
      touchInit(f.path);
    }
    await manager.writeFiles(
      session,
      files.map((f) => ({ path: f.path, data: f.data, mode: session.modes.get(f.path) })),
    );
  };

  const remove = async (paths: string[]) => {
    for (const p of paths) {
      known.delete(p);
      echoes.delete(p);
      session.modes.delete(p);
      touchInit(p);
    }
    for (let i = 0; i < paths.length; i += RM_CHUNK) {
      await manager.run(session, ['rm', '-rf', '--', ...paths.slice(i, i + RM_CHUNK).map((p) => `${WORKSPACE}/${p}`)]);
    }
  };

  // App deletes of paths the container owns itself (an oversize file or a
  // symlink). The app only sends one when the path became owned after its last
  // look (its own diff skips owned paths), so the user did delete or rename it:
  // - A plain delete is carried out: the user asked for the path to go, and
  //   keeping it would bring the file back on the phone at the next reconnect.
  // - A rename arrives as this delete plus a 'file' for the new path holding
  //   what the app last had at the old one (its agreed hash). Then the
  //   container's (bigger, newer) file is moved to the new path instead of
  //   being replaced by the app's stale copy, and the app is told the container
  //   owns the new path ('skipped').
  // So each delete waits its own renameWindowMs for such a 'file' before it
  // runs. When the socket closes, deletes still waiting are dropped: the
  // rename's 'file' may be about to arrive in the next connection's init, and
  // deleting now would lose the container's copy.
  // Paths inside a symlinked folder are never deleted from the app: rm would
  // reach through the link, and the app's view of them is stale.
  // path -> the hash the app last agreed on for it (undefined: none).
  type OwnedDelete = { hash: string | undefined };
  const ownedDeletes = new Map<string, OwnedDelete>();
  const ownedTimers = new Set<NodeJS.Timeout>();

  const flushOwnedDelete = async (path: string, entry: OwnedDelete) => {
    if (ownedDeletes.get(path) !== entry) return; // Moved by a rename, or superseded.
    ownedDeletes.delete(path);
    // A path the container changed since (it shrank and was sent to the app) is newer than the delete: kept.
    if (!session.skipped.delete(path)) return;
    await remove([path]);
  };

  const deleteOwned = (path: string) => {
    const entry: OwnedDelete = { hash: session.agreed?.get(path) };
    ownedDeletes.set(path, entry);
    session.agreed?.delete(path);
    known.delete(path);
    const timer = setTimeout(() => {
      ownedTimers.delete(timer);
      chain = chain.then(() => flushOwnedDelete(path, entry)).catch((e: Error) => ws.close(1011, e.message.slice(0, 100)));
    }, renameWindowMs);
    timer.unref();
    ownedTimers.add(timer);
  };

  // Moves a container-owned file the app just renamed; false if it wasn't a rename after all.
  const moveOwned = async (to: string, hash: string): Promise<boolean> => {
    let from: string | undefined;
    for (const [p, e] of ownedDeletes) if (e.hash !== undefined && e.hash === hash && session.skipped.has(p)) from = p;
    if (from === undefined) return false;
    const entry = ownedDeletes.get(from)!;
    ownedDeletes.delete(from);
    const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
    if (dir) await manager.run(session, ['mkdir', '-p', '--', `${WORKSPACE}/${dir}`]);
    if ((await manager.run(session, ['mv', '-fT', '--', `${WORKSPACE}/${from}`, `${WORKSPACE}/${to}`])) !== 0) {
      ownedDeletes.set(from, entry); // Still deleted, once its window ends.
      return false;
    }
    session.skipped.delete(from);
    session.skipped.add(to);
    session.modes.delete(to);
    known.delete(to);
    session.agreed?.delete(to);
    send({ type: 'skipped', path: to });
    return true;
  };

  const sendFile = (path: string, data: string, hash: string) => {
    known.set(path, hash);
    touchInit(path);
    unacked.push({ path, hash, seq: appWrites.get(path) ?? 0 });
    send({ type: 'file', path, data });
  };

  const sendDelete = (path: string) => {
    known.delete(path);
    touchInit(path);
    unacked.push({ path, hash: null, seq: appWrites.get(path) ?? 0 });
    send({ type: 'delete', path });
  };

  // The app wrote or deleted `path` (its result: `hash`, null for a delete).
  // If a container change it hasn't acknowledged crossed it on the wire, the
  // app will apply that change over its own write when it arrives, while the
  // container keeps the app's write: send the app's result back so both end
  // up with it.
  const crossed = (path: string, hash: string | null, data: string) => {
    const last = unacked.findLast((u) => u.path === path);
    if (!last || last.hash === hash) return;
    if (hash === null) sendDelete(path);
    else sendFile(path, data, hash);
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
        if (isEcho(path, hash)) {
          // Our own write. If it's an older one, a newer write is on its way
          // and the watcher will see it: the app keeps its newer copy.
          if (known.get(path) === hash) echoes.delete(path);
          return;
        }
        if (init) init.later.push({ path, at: ++init.clock, file: { data, hash }, wasSkipped: false });
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
          init.later.push({ path, at: ++init.clock, file: null, wasSkipped });
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
        lines.on('close', () => {
          if (!snapshot) reject(new Error('file watcher exited'));
          // Container changes would go unnoticed from now on: close, so the app
          // reconnects and a fresh init (with a new watcher) reconciles.
          else if (!closed && watcher === proc) ws.close(1011, 'file watcher exited');
        });
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

  // A free name for the phone's side of a conflict: not a container file (owned
  // ones included), nor any path the phone has (sent, unsent, or already a copy),
  // nor a folder on either side (`dirs`).
  // Only called after the last init batch, when `seen` holds every phone path.
  const conflictName = (state: InitState, dirs: Set<string>, path: string) => {
    for (let n = 1; ; n++) {
      const name = `${path}${CONFLICT_SUFFIX}${n > 1 ? `-${n}` : ''}`;
      if (!state.container.has(name) && !state.seen.has(name) && !dirs.has(name) && !containerOwned(name)) return name;
    }
  };

  const parentDirs = (paths: Iterable<string>, into: Set<string>) => {
    for (const p of paths) for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) into.add(p.slice(0, i));
    return into;
  };

  const handleInit = async (msg: SyncInitMessage) => {
    if (initDone) {
      // A second init on one connection (the app doesn't send one): plain writes.
      for (const f of msg.files) await handle({ type: 'file', path: f.path, data: f.data });
      send(msg.more ? { type: 'init-ack' } : { type: 'ready' });
      return;
    }
    if (!init) {
      const first = !session.agreed;
      init = {
        first,
        container: new Map(),
        seen: new Set(),
        unsent: new Set(),
        toApp: new Set(),
        deleteOnApp: new Set(),
        conflicts: [],
        spill: null,
        later: [],
        touched: new Map(),
        clock: 0,
      };
      await startWatcher(init);
      session.agreed ??= new Map();
    }
    const state = init;
    const agreed = session.agreed!;
    const writes: { path: string; data: Buffer; hash: string }[] = [];
    const spill: TarFile[] = [];
    for (const p of Array.isArray(msg.skippedPaths) ? msg.skippedPaths : []) {
      let path: string;
      try {
        path = safePath(p);
      } catch {
        continue;
      }
      state.seen.add(path);
      state.unsent.add(path);
    }
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
          // The container's file keeps its name; the phone's version is kept
          // next to it (named after the last batch, parked in the container until then).
          state.spill ??= `tide-conflicts-${crypto.randomBytes(8).toString('hex')}`;
          const tmp = `${state.spill}/${state.conflicts.length}`;
          spill.push({ path: tmp, data, mode: session.modes.get(path) });
          state.conflicts.push({ path, tmp, hash });
          known.set(path, container!);
          state.toApp.add(path);
          break;
        }
      }
    }
    await write(writes);
    await manager.writeFiles(session, spill, { dir: SPILL_DIR });
    if (msg.more) {
      send({ type: 'init-ack' });
      return;
    }

    // Every phone path is known now: name the conflict copies and move them into place.
    const dirs = parentDirs(session.skipped, parentDirs(state.seen, parentDirs(state.container.keys(), new Set())));
    const copies: string[] = [];
    const moves: [string, string][] = [];
    for (const c of state.conflicts) {
      const copy = conflictName(state, dirs, c.path);
      state.seen.add(copy);
      const mode = session.modes.get(c.path);
      if (mode !== undefined) session.modes.set(copy, mode);
      known.set(copy, c.hash);
      addEcho(copy, c.hash);
      touchInit(copy);
      copies.push(copy);
      moves.push([`${SPILL_DIR}/${c.tmp}`, `${WORKSPACE}/${copy}`]);
    }
    if (moves.length) await manager.moveFiles(session, moves);
    await dropSpill(state);

    // A file the phone has but couldn't send: the container's copy (if any)
    // stays, and isn't sent over the phone's.
    for (const path of state.unsent) state.toApp.delete(path);

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
    // Gone on both sides: nothing left to agree on. A record kept here would
    // read a later container file with the same content as a phone delete.
    for (const path of [...agreed.keys()]) {
      if (!state.container.has(path) && !state.seen.has(path) && !containerOwned(path)) agreed.delete(path);
    }
    await remove(removeHere);
    // The copies are read back from the container rather than kept in memory.
    await sendFromContainer(state, [...copies, ...state.toApp]);
    for (const path of state.deleteOnApp) sendDelete(path);
    init = null;
    initDone = true;
    replay(state);
    send({ type: 'ready' });
  };

  // Delivers the watcher reports that came in during the init: only each
  // path's last one, and only if nothing superseded it. A report the init's
  // own write, delete, read or send came after is stale, and so is one that
  // no longer matches the container (a later report, an echo of our own
  // write, changed it).
  const replay = (state: InitState) => {
    const last = new Map<string, InitState['later'][number]>();
    const wasSkipped = new Set<string>();
    for (const l of state.later) {
      if (l.wasSkipped) wasSkipped.add(l.path);
      last.delete(l.path);
      last.set(l.path, l);
    }
    for (const l of last.values()) {
      if ((state.touched.get(l.path) ?? 0) > l.at) continue;
      if (l.file === null) {
        if (!state.container.has(l.path)) deliverDelete(l.path, wasSkipped.has(l.path));
      } else if (state.container.get(l.path) === l.file.hash) deliverFile(l.path, l.file.data, l.file.hash);
    }
  };

  const dropSpill = async (state: InitState) => {
    if (state.spill === null) return;
    const dir = `${SPILL_DIR}/${state.spill}`;
    state.spill = null;
    await manager.run(session, ['rm', '-rf', '--', dir]);
  };

  const handle = async (msg: SyncToServer): Promise<void> => {
    touch();
    switch (msg.type) {
      case 'init':
        return handleInit(msg);
      case 'file': {
        const path = safePath(msg.path);
        const data = Buffer.from(msg.data, 'base64');
        const hash = hashBytes(data);
        appWrites.set(path, (appWrites.get(path) ?? 0) + 1);
        if (ownedDeletes.size && !isSyncSkipped(path) && !containerOwned(path) && (await moveOwned(path, hash))) return;
        if (!writable(path)) return;
        session.agreed?.set(path, hash);
        await write([{ path, data, hash }]);
        crossed(path, hash, msg.data);
        return;
      }
      case 'delete': {
        const path = safePath(msg.path);
        appWrites.set(path, (appWrites.get(path) ?? 0) + 1);
        if (!isSyncSkipped(path) && session.skipped.has(path)) return deleteOwned(path);
        if (!writable(path)) return;
        session.agreed?.delete(path);
        await remove([path]);
        crossed(path, null, '');
        return;
      }
      case 'ack': {
        const i = unacked.findIndex((u) => u.path === msg.path);
        if (i === -1) return;
        const [{ path, hash, seq }] = unacked.splice(i, 1);
        const agreed = session.agreed;
        if (!agreed) return;
        // The app wrote the path after this was sent: its write set `agreed`, and this ack is stale.
        if ((appWrites.get(path) ?? 0) !== seq) return;
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
    // Owned deletes still in their rename window are dropped (see ownedDeletes).
    for (const t of ownedTimers) clearTimeout(t);
    ownedTimers.clear();
    ownedDeletes.clear();
    echoes.clear();
    // An init cut off before its last batch leaves its parked conflict copies behind.
    chain = chain
      .then(async () => {
        if (init) await dropSpill(init);
      })
      .catch(() => undefined);
  });
}
