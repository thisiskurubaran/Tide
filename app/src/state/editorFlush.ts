// Open editors hold back their last keystrokes for a moment (their change
// messages are debounced). Each registers how to flush them here, so the
// state can get that typing into the buffers before acting on a file, e.g.
// before a buffer whose file was deleted on disk goes away.
const flushers = new Set<() => Promise<void>>();

export function registerEditorFlush(flush: () => Promise<void>): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

export async function flushEditors(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch(() => undefined)));
}
