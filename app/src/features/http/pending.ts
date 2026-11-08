// A request a link asked to send (tide://project/x?file=api.http&send=1), for
// the .http file's pane to pick up once it has parsed the file.
//
// A send is only good for a short while after the user confirmed it, and only
// while the pane is (or is about to be) open: one left waiting would fire
// whenever the file is next opened, long after anyone remembers the link. The
// pane cancels its file's send when it closes.
export const PENDING_SEND_MS = 30_000;

const pending = new Map<string, { which: string; at: number }>();
const key = (project: string, path: string) => `${project}/${path}`;

const listeners = new Set<(project: string, path: string) => void>();

export function requestSend(project: string, path: string, which: string, now = Date.now()) {
  pending.set(key(project, path), { which, at: now });
  for (const l of listeners) l(project, path);
}

// The pane for the file closed: a send asked for while it was open (since
// `since`) and not taken is dropped. One asked for before it opened is left
// for the pane that opens next (it has PENDING_SEND_MS).
export function cancelSend(project: string, path: string, since = -Infinity) {
  const waiting = pending.get(key(project, path));
  if (waiting && waiting.at >= since) pending.delete(key(project, path));
}

// For a pane that's already open when the request comes (after the link's
// confirmation). Returns the unsubscribe.
export function onSendRequested(listener: (project: string, path: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The index of the request to send, if one is waiting: a number is a
// position ("1" the first), anything else a request's name. A position past
// the last request, or a name no request has, sends nothing.
export function takeSend(project: string, path: string, names: string[], now = Date.now()): number | null {
  const waiting = pending.get(key(project, path));
  if (waiting === undefined) return null;
  if (now - waiting.at > PENDING_SEND_MS) {
    pending.delete(key(project, path));
    return null;
  }
  if (!names.length) return null;
  pending.delete(key(project, path));
  const { which } = waiting;
  if (/^\s*\d+\s*$/.test(which)) {
    const n = Number(which);
    return n >= 1 && n <= names.length ? n - 1 : null;
  }
  const i = names.findIndex((name) => name.trim().toLowerCase() === which.trim().toLowerCase());
  return i >= 0 ? i : null;
}
