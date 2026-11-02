// Turns one terminal's output into Problems: lines go through the matchers,
// paths are mapped to project files, and the results are published under
// "output:<key>" so each terminal replaces only its own. A new command line
// (Enter) starts a fresh set, like a re-run task in a desktop IDE.
import type { Diagnostic, DiagnosticsState } from '../../extensions/diagnostics';
import { lineStarts, offsetAt } from '../../extensions/diagnostics';
import { projectFileFor } from '../terminal/fileRefs';
import { OutputProblem, ProblemMatcher } from './matchers';

export const PUBLISH_MS = 300;
// Plenty for a real build; stops a runaway loop from flooding the panel.
export const MAX_PROBLEMS = 500;

interface Deps {
  project: string;
  key: string;
  files(): Promise<string[]>;
  readText(path: string): Promise<string | null>;
  store: { getState(): Pick<DiagnosticsState, 'set'> };
}

export function createOutputCollector({ project, key, files, readText, store }: Deps) {
  const source = `output:${key}`;
  let matcher = new ProblemMatcher();
  let partial = '';
  let found: OutputProblem[] = [];
  let published = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  async function publish() {
    timer = null;
    const gen = generation;
    const list = await files().catch(() => [] as string[]);
    const byPath = new Map<string, Diagnostic[]>();
    const texts = new Map<string, number[] & { text?: string }>();
    for (const p of found) {
      const path = projectFileFor(p.path, project, list);
      if (!path) continue;
      if (!texts.has(path)) {
        const text = (await readText(path).catch(() => null)) ?? '';
        texts.set(path, Object.assign(lineStarts(text), { text }));
      }
      const starts = texts.get(path)!;
      const from = offsetAt(starts, starts.text!, p.line, p.column);
      const lineEnd = p.line < starts.length ? starts[p.line] - 1 : starts.text!.length;
      const items = byPath.get(path) ?? [];
      if (!items.some((d) => d.line === p.line && d.message === p.message)) {
        items.push({ from, to: Math.max(from, lineEnd), line: p.line, column: p.column, severity: p.severity, message: p.message, source: p.source });
      }
      byPath.set(path, items);
    }
    if (gen !== generation) return;
    for (const path of published) if (!byPath.has(path)) store.getState().set(project, path, source, []);
    for (const [path, items] of byPath) store.getState().set(project, path, source, items);
    published = new Set(byPath.keys());
  }

  const schedule = () => {
    if (timer === null) timer = setTimeout(publish, PUBLISH_MS);
  };

  return {
    write(data: string) {
      const lines = (partial + data).split('\n');
      partial = lines.pop() ?? '';
      // Overly long partial lines (progress bars) aren't problems.
      if (partial.length > 4000) partial = '';
      let added = false;
      for (const line of lines) {
        for (const p of matcher.feed(line)) {
          if (found.length < MAX_PROBLEMS) {
            found.push(p);
            added = true;
          }
        }
      }
      if (added) schedule();
    },
    // A new command: what the last one printed no longer applies.
    reset() {
      generation++;
      matcher = new ProblemMatcher();
      partial = '';
      found = [];
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const path of published) store.getState().set(project, path, source, []);
      published = new Set();
    },
    // Flushes now (tests, and before reading the Problems panel).
    flush: () => publish(),
  };
}

export type OutputCollector = ReturnType<typeof createOutputCollector>;
