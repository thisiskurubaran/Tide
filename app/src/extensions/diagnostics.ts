import { createStore, useStore } from 'zustand';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  // Offsets into the text the diagnostic was computed for.
  from: number;
  to: number;
  // 1-based, for the Problems panel.
  line: number;
  column: number;
  severity: Severity;
  message: string;
  // Which tool reported it, e.g. "eslint" or "ts".
  source: string;
}

export interface DiagnosticsState {
  // project -> path -> source -> diagnostics
  byProject: Record<string, Record<string, Record<string, Diagnostic[]>>>;
  set(project: string, path: string, source: string, items: Diagnostic[]): void;
  // Drops one source everywhere (an extension was switched off) or one file.
  clearSource(source: string): void;
  clearPath(project: string, path: string): void;
}

export function createDiagnosticsStore() {
  return createStore<DiagnosticsState>()((set) => ({
    byProject: {},
    set: (project, path, source, items) =>
      set((s) => {
        const files = { ...s.byProject[project] };
        const sources = { ...files[path] };
        if (items.length) sources[source] = items;
        else delete sources[source];
        if (Object.keys(sources).length) files[path] = sources;
        else delete files[path];
        return { byProject: { ...s.byProject, [project]: files } };
      }),
    clearSource: (source) =>
      set((s) => {
        const byProject: DiagnosticsState['byProject'] = {};
        for (const [project, files] of Object.entries(s.byProject)) {
          byProject[project] = {};
          for (const [path, sources] of Object.entries(files)) {
            const { [source]: _dropped, ...rest } = sources;
            if (Object.keys(rest).length) byProject[project][path] = rest;
          }
        }
        return { byProject };
      }),
    clearPath: (project, path) =>
      set((s) => {
        if (!s.byProject[project]?.[path]) return s;
        const { [path]: _dropped, ...files } = s.byProject[project];
        return { byProject: { ...s.byProject, [project]: files } };
      }),
  }));
}

export const diagnosticsStore = createDiagnosticsStore();
export const useDiagnostics = <T>(selector: (s: DiagnosticsState) => T) => useStore(diagnosticsStore, selector);

const EMPTY: Diagnostic[] = [];
const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function fileDiagnostics(s: DiagnosticsState, project: string, path: string): Diagnostic[] {
  const sources = s.byProject[project]?.[path];
  if (!sources) return EMPTY;
  return Object.values(sources)
    .flat()
    .sort((a, b) => a.from - b.from || order[a.severity] - order[b.severity]);
}

// Line and column (1-based) to an offset, and the other way, for tools that only speak one of them.
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function offsetAt(starts: number[], text: string, line: number, column: number): number {
  const l = Math.min(Math.max(line, 1), starts.length) - 1;
  const end = l + 1 < starts.length ? starts[l + 1] - 1 : text.length;
  return Math.min(starts[l] + Math.max(column, 1) - 1, end);
}

export function positionAt(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}
