// Format & Lint for Python runs in the app's Python (tide_tools.py), reached
// through the runtime's snippet() call with a marker so no native code changed.
export type Snippet = (code: string) => Promise<string>;

const PREFIX = '#tide-tool\n';

export function createPythonTools(snippet: Snippet) {
  return {
    async request<T>(method: 'lint' | 'format', params: { path: string; content: string }): Promise<T> {
      const raw = await snippet(PREFIX + JSON.stringify({ method, params }));
      const reply = JSON.parse(raw) as { result?: T; error?: string };
      if (reply.error !== undefined) throw new Error(reply.error);
      return reply.result as T;
    },
  };
}
