// A request a link asked to send (tide://project/x?file=api.http&send=1), for
// the .http file's pane to pick up once it has parsed the file.
const pending = new Map<string, string>();
const key = (project: string, path: string) => `${project}/${path}`;

const listeners = new Set<(project: string, path: string) => void>();

export function requestSend(project: string, path: string, which: string) {
  pending.set(key(project, path), which);
  for (const l of listeners) l(project, path);
}

// For a pane that's already open when the request comes (after the link's
// confirmation). Returns the unsubscribe.
export function onSendRequested(listener: (project: string, path: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// The index of the request to send, if one is waiting: "1" (or a number) is
// a position, anything else a request's name.
export function takeSend(project: string, path: string, names: string[]): number | null {
  const which = pending.get(key(project, path));
  if (which === undefined || !names.length) return null;
  pending.delete(key(project, path));
  const n = Number(which);
  if (Number.isInteger(n) && n >= 1) return Math.min(n, names.length) - 1;
  const i = names.findIndex((name) => name.trim().toLowerCase() === which.trim().toLowerCase());
  return i >= 0 ? i : null;
}
