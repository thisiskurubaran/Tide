// Crash reports must not carry the user's code or project names. Any path
// under Documents names a project or file, so the whole path becomes
// <documents>, and the parts of an event that can hold user input are dropped.
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function scrubPaths<T>(value: T, documents: string): T {
  if (!documents) return value;
  const prefixes = [`file://${encodeURI(documents)}`, `file://${documents}`, documents].map(escape);
  // Runs to a quote, bracket or line end rather than a space, since project names can contain spaces.
  const pattern = new RegExp(`(?:${prefixes.join('|')})[^\\n'"()\\[\\]]*`, 'g');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(pattern, '<documents>');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

type EventLike = { breadcrumbs?: unknown; request?: unknown; user?: unknown; extra?: unknown; server_name?: unknown };

export function scrubEvent<T extends EventLike>(event: T, documents: string): T {
  const { breadcrumbs: _b, request: _r, user: _u, extra: _e, server_name: _s, ...rest } = event;
  return scrubPaths(rest as T, documents);
}
