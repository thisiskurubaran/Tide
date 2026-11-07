// TODO, FIXME, HACK, XXX and BUG notes in a project's comments.
import type { SearchFiles } from '../search/search';
import { pathFilter } from '../search/search';

export type TodoTag = 'TODO' | 'FIXME' | 'HACK' | 'XXX' | 'BUG';

export interface Todo {
  path: string;
  line: number; // 1-based
  tag: TodoTag;
  text: string;
}

const MAX_TODOS = 1000;
const MAX_FILE_CHARS = 1_000_000;
// Generated and vendored code isn't yours to fix.
const SKIP = pathFilter('', '*.min.js, *.min.css, *.map, *.lock, package-lock.json, *.generated.*, dist/, build/, vendor/, .pylibs/');

// A tag inside a comment: after //, #, /*, *, <!--, -- (SQL, Lua), ; or %.
const NOTE = /(?:\/\/|#|\/\*|^\s*\*|<!--|--|;|%)\s*(?:.*?\s)?(TODO|FIXME|HACK|XXX|BUG)\b\s*(?:\([^)]*\))?\s*[:-]?\s*(.*)$/;

export function todosIn(path: string, content: string): Todo[] {
  const out: Todo[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = NOTE.exec(lines[i]);
    if (!m) continue;
    const text = m[2].replace(/\s*(\*\/|-->)\s*$/, '').trim();
    out.push({ path, line: i + 1, tag: m[1] as TodoTag, text });
  }
  return out;
}

export async function findTodos(files: SearchFiles, project: string): Promise<{ todos: Todo[]; truncated: boolean }> {
  const todos: Todo[] = [];
  for (const path of (await files.listFiles(project)).filter(SKIP).sort()) {
    const content = await files.readFile(project, path).catch(() => null);
    if (content === null || content.length > MAX_FILE_CHARS || content.includes('\u0000')) continue;
    todos.push(...todosIn(path, content));
    if (todos.length >= MAX_TODOS) return { todos: todos.slice(0, MAX_TODOS), truncated: true };
  }
  return { todos, truncated: false };
}
