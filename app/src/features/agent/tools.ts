// The agent's tools: JSON Schema specs for the model, and executors over the
// project. Reads see the agent's own pending changes; writes only stage them
// (changes.ts) and never touch disk. run_command is the one tool that needs
// the user's approval, which the loop asks for before running it.
import type { ToolSpec } from '../ai/client';
import { normalizePath, WorkspaceError } from '../files/workspace';
import { SearchError, searchProject } from '../search/search';
import { ChangeConflictError, ChangesNotSavedError, ChangesStore, diffStats, FileChange } from './changes';

// ---------------------------------------------------------------------------
// What the tools work on

export interface AgentFiles {
  // Every file in the project (node_modules, .git and the like already skipped).
  listFiles(): Promise<string[]>;
  // The file as the user has it (open editor text included); null if it doesn't exist.
  read(path: string): Promise<string | null>;
}

export interface CommandResult {
  output: string;
  // The program's exit code; null for a built-in command that ran no program.
  code: number | null;
  timedOut: boolean;
}

export interface CommandRunner {
  run(command: string, options: { signal?: AbortSignal; timeoutMs: number }): Promise<CommandResult>;
}

export interface ToolEnv {
  project: string;
  files: AgentFiles;
  changes: ChangesStore;
  commands: CommandRunner;
}

// How a step shows in the chat: a verb and mono chips, with +N/−N for edits.
export type StepVerb = 'Listed' | 'Read' | 'Searched' | 'Edited' | 'Created' | 'Ran' | 'Finished' | 'Used';

export interface StepView {
  verb: StepVerb;
  chips: string[];
  added?: number;
  removed?: number;
}

export interface TestRun {
  command: string;
  code: number | null;
  timedOut: boolean;
  // The last meaningful output line, e.g. "Tests: 12 passed, 12 total".
  summary: string;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  view?: Partial<StepView>;
  // Set by finish: the run ends after this turn's results are sent.
  finish?: string;
  test?: TestRun;
}

export interface AgentTool {
  spec: ToolSpec;
  // The command to ask about, for tools that need approval.
  approval?(input: Record<string, unknown>): string;
  describe(input: Record<string, unknown>): StepView;
  run(input: Record<string, unknown>, env: ToolEnv, signal?: AbortSignal): Promise<ToolOutcome>;
}

// ---------------------------------------------------------------------------
// Limits

export const MAX_LIST = 400;
export const MAX_READ_LINES = 2000;
export const MAX_READ_CHARS = 80_000;
export const MAX_SEARCH_MATCHES = 80;
export const MAX_OUTPUT_CHARS = 6000;
export const COMMAND_TIMEOUT_MS = 120_000;
// Folders the agent may read but not write: tools and installs manage them.
const READ_ONLY_DIRS = ['.git', 'node_modules', '.pylibs', '.tide'];

export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Paths

// A project-relative path. Absolute paths, "..", "~" and backslashes are refused.
export function safePath(input: unknown, { allowRoot = false } = {}): string {
  if (typeof input !== 'string') throw new ToolError('path must be a string');
  const raw = input.trim();
  if (!raw || raw === '.' || raw === './') {
    if (allowRoot) return '';
    throw new ToolError('path is empty');
  }
  if (raw.startsWith('/') || raw.startsWith('~') || /^[a-zA-Z]:/.test(raw)) throw new ToolError(`"${raw}" is absolute; use a path relative to the project root, e.g. src/index.js`);
  if (raw.includes('\\')) throw new ToolError(`"${raw}" uses backslashes; use / between folders`);
  if (raw.split('/').some((p) => p === '..')) throw new ToolError(`"${raw}" leaves the project; ".." isn't allowed`);
  try {
    return normalizePath(raw);
  } catch (e) {
    throw new ToolError(e instanceof WorkspaceError ? e.message : String(e));
  }
}

function writablePath(input: unknown): string {
  const path = safePath(input);
  const top = path.split('/')[0];
  if (READ_ONLY_DIRS.includes(top)) throw new ToolError(`${top}/ is managed by Tide's tools; edit project files instead`);
  return path;
}

const pendingOf = (env: ToolEnv, path: string): FileChange | undefined => env.changes.getState().byProject[env.project]?.[path];

// The file as the agent should see it: its pending version when it has one.
async function currentText(env: ToolEnv, path: string): Promise<string | null> {
  const pending = pendingOf(env, path);
  if (pending) return pending.proposed;
  return env.files.read(path);
}

async function allFiles(env: ToolEnv): Promise<string[]> {
  const listed = new Set(await env.files.listFiles());
  for (const path of Object.keys(env.changes.getState().byProject[env.project] ?? {})) listed.add(path);
  return [...listed].sort();
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const base = (path: string) => path.split('/').pop() || path;

// ---------------------------------------------------------------------------
// Text helpers

export function numberLines(text: string, start = 1, end?: number): { text: string; from: number; to: number; total: number; cut: boolean } {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const total = lines.length;
  const from = Math.max(1, Math.min(start, Math.max(total, 1)));
  let to = Math.min(total, end ?? total, from + MAX_READ_LINES - 1);
  const width = String(to).length;
  const out: string[] = [];
  let chars = 0;
  let cut = to < Math.min(total, end ?? total);
  for (let n = from; n <= to; n++) {
    const line = `${String(n).padStart(width)}\t${lines[n - 1]}`;
    if (chars + line.length > MAX_READ_CHARS) {
      to = n - 1;
      cut = true;
      break;
    }
    out.push(line);
    chars += line.length + 1;
  }
  return { text: out.join('\n'), from, to, total, cut };
}

// Exact-match replacement: old_text must appear once.
export function replaceExact(content: string, oldText: string, newText: string): string {
  if (!oldText) throw new ToolError('old_text is empty; to add text, include a nearby line in old_text and new_text, or use write_file');
  const first = content.indexOf(oldText);
  if (first < 0) {
    const trimmed = oldText.trim();
    const hint = trimmed && content.includes(trimmed) ? ' (it matches with different leading or trailing whitespace; copy the text exactly)' : ' Read the file again and copy the text exactly, including indentation.';
    throw new ToolError(`old_text wasn't found in the file.${hint}`);
  }
  let count = 0;
  for (let i = content.indexOf(oldText); i >= 0; i = content.indexOf(oldText, i + oldText.length)) count++;
  if (count > 1) throw new ToolError(`old_text appears ${count} times; include more surrounding lines so it matches exactly once`);
  return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

export function tail(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `…(${text.length - max} earlier characters cut)\n${text.slice(-max)}`;
}

// The first word of a command: what "Always for npm" remembers.
export function commandKey(command: string): string {
  return command.trim().split(/\s+/)[0] ?? '';
}

export const isTestCommand = (command: string) =>
  /(^|[\s/._-])(test|tests|spec|jest|vitest|mocha|pytest|unittest|ava)([\s.:_-]|$)/.test(command) || /\bnpm\s+(t|tst)\b/.test(command);

export function testSummary(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const hit = [...lines].reverse().find((l) => /\b(tests?|passed|failed|passing|failing|ok|error)\b/i.test(l) && !/^\[exited/.test(l));
  return (hit ?? lines[lines.length - 1] ?? '').slice(0, 160);
}

// ---------------------------------------------------------------------------
// The tools

const listFiles: AgentTool = {
  spec: {
    name: 'list_files',
    description:
      'List the files in the project, or in one folder of it. Call this first to find your way around, and whenever you need a path you have not seen. node_modules and .git are skipped.',
    inputSchema: {
      type: 'object',
      properties: { dir: { type: 'string', description: 'Folder relative to the project root, e.g. "src". Omit for the whole project.' } },
      additionalProperties: false,
    },
  },
  describe: (input) => ({ verb: 'Listed', chips: [str(input.dir) ? `${str(input.dir).replace(/\/$/, '')}/` : 'project'] }),
  async run(input, env) {
    const dir = input.dir === undefined ? '' : safePath(input.dir, { allowRoot: true });
    const files = (await allFiles(env)).filter((p) => !dir || p.startsWith(`${dir}/`));
    if (!files.length) return { content: dir ? `No files in ${dir}/ (or it doesn't exist).` : 'The project has no files yet.' };
    const shown = files.slice(0, MAX_LIST);
    const more = files.length - shown.length;
    return { content: shown.join('\n') + (more ? `\n…and ${more} more. Pass dir to list one folder.` : '') };
  },
};

const readFile: AgentTool = {
  spec: {
    name: 'read_file',
    description:
      'Read a text file with line numbers. Read a file before editing it. If you already changed the file, this shows your pending version. Long files are cut; pass start_line and end_line to read a part.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root, e.g. "src/app.js".' },
        start_line: { type: 'integer', description: 'First line to read, 1-based. Default 1.' },
        end_line: { type: 'integer', description: 'Last line to read, inclusive. Default: the end of the file.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  describe: (input) => ({ verb: 'Read', chips: [base(str(input.path))] }),
  async run(input, env) {
    const path = safePath(input.path);
    const content = await currentText(env, path);
    if (content === null) throw new ToolError(`${path} doesn't exist. Use list_files to see the project's files.`);
    if (content.includes('\u0000')) throw new ToolError(`${path} is a binary file`);
    if (!content) return { content: `${path} is empty.` };
    const start = typeof input.start_line === 'number' ? input.start_line : 1;
    const end = typeof input.end_line === 'number' ? input.end_line : undefined;
    const r = numberLines(content, start, end);
    const head = `${path}${pendingOf(env, path) ? ' (your pending version)' : ''}: lines ${r.from}-${r.to} of ${r.total}`;
    const more = r.cut ? `\n…cut at line ${r.to}. Read on with start_line ${r.to + 1}.` : '';
    return { content: `${head}\n${r.text}${more}` };
  },
};

const search: AgentTool = {
  spec: {
    name: 'search',
    description:
      'Search every project file for text (case-insensitive) and list matching lines as path:line: text. Use it to find where something is defined or used before reading whole files. Pending changes are searched too.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to find.' },
        regex: { type: 'boolean', description: 'Treat query as a JavaScript regular expression. Default false.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  describe: (input) => ({ verb: 'Searched', chips: [str(input.query).slice(0, 40)] }),
  async run(input, env) {
    const query = str(input.query);
    if (!query) throw new ToolError('query is empty');
    let result;
    try {
      result = await searchProject(
        {
          listFiles: () => allFiles(env),
          readFile: async (_p, path) => {
            const text = await currentText(env, path);
            if (text === null) throw new Error('missing');
            return text;
          },
        },
        env.project,
        query,
        { regex: input.regex === true, limit: MAX_SEARCH_MATCHES },
      );
    } catch (e) {
      if (e instanceof SearchError) throw new ToolError(`Invalid regular expression: ${e.message}`);
      throw e;
    }
    if (!result.total) return { content: `No matches for "${query}".` };
    const lines = result.files.flatMap((f) => f.matches.map((m) => `${f.path}:${m.line}: ${m.text}`));
    const files = result.files.length;
    return {
      content: `${result.total} match${result.total === 1 ? '' : 'es'} in ${files} file${files === 1 ? '' : 's'}${result.truncated ? ` (first ${MAX_SEARCH_MATCHES} shown; narrow the query)` : ''}:\n${lines.join('\n')}`,
    };
  },
};

async function stage(env: ToolEnv, path: string, next: string): Promise<ToolOutcome> {
  const pending = pendingOf(env, path);
  const before = await currentText(env, path);
  const existed = pending ? pending.original !== null : before !== null;
  // Without a pending change, `before` is the file as the user has it: the change's original.
  env.changes.getState().stage(env.project, path, pending ? null : before, next);
  const { added, removed } = diffStats(before, next);
  const verb = existed ? 'Edited' : 'Created';
  return {
    content: `${verb === 'Created' ? 'Created' : 'Changed'} ${path} (+${added} −${removed}). The change is pending until the user reviews it; read_file and run_command see it.`,
    view: { verb, added, removed },
  };
}

const writeFile: AgentTool = {
  spec: {
    name: 'write_file',
    description:
      'Create a file, or replace a whole file with new content. Prefer edit_file for changes to an existing file. Folders are created as needed. The change stays pending until the user reviews it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        content: { type: 'string', description: 'The complete new file content.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  describe: (input) => ({ verb: 'Edited', chips: [base(str(input.path))] }),
  async run(input, env) {
    const path = writablePath(input.path);
    return stage(env, path, str(input.content));
  },
};

const editFile: AgentTool = {
  spec: {
    name: 'edit_file',
    description:
      'Replace one exact piece of text in an existing file. old_text must match the file exactly (whitespace and indentation included) and appear exactly once, so include a few surrounding lines when it is short. Make several small edits rather than one large one. The change stays pending until the user reviews it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root.' },
        old_text: { type: 'string', description: 'The exact text to replace, copied from read_file output without the line numbers.' },
        new_text: { type: 'string', description: 'The text to put in its place. Empty to delete old_text.' },
      },
      required: ['path', 'old_text', 'new_text'],
      additionalProperties: false,
    },
  },
  describe: (input) => ({ verb: 'Edited', chips: [base(str(input.path))] }),
  async run(input, env) {
    const path = writablePath(input.path);
    const content = await currentText(env, path);
    if (content === null) throw new ToolError(`${path} doesn't exist. Use write_file to create it.`);
    return stage(env, path, replaceExact(content, str(input.old_text), str(input.new_text)));
  },
};

const runCommand: AgentTool = {
  spec: {
    name: 'run_command',
    description:
      "Run one command in the project's local terminal and get its output and exit code. Use it to run tests (npm test, node test.js, python test_app.py), package.json scripts and git. The user approves every command. Your pending changes are written to disk first so the program sees them. Don't start servers or anything that waits for input; commands stop after 2 minutes.",
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The command line, e.g. "npm test" or "node scripts/check.js".' } },
      required: ['command'],
      additionalProperties: false,
    },
  },
  approval: (input) => str(input.command).trim(),
  describe: (input) => ({ verb: 'Ran', chips: [str(input.command).trim().slice(0, 60)] }),
  async run(input, env, signal) {
    const command = str(input.command).replace(/[\r\n]+/g, ' ').trim();
    if (!command) throw new ToolError('command is empty');
    try {
      await env.changes.getState().applyToDisk(env.project);
    } catch (e) {
      if (e instanceof ChangeConflictError) throw new ToolError(`${e.path} was changed outside the agent, so pending changes weren't written. Read it again before continuing.`);
      if (e instanceof ChangesNotSavedError) throw new ToolError(`${e.message} The command wasn't run.`);
      throw e;
    }
    let result: CommandResult;
    try {
      result = await env.commands.run(command, { signal, timeoutMs: COMMAND_TIMEOUT_MS });
    } finally {
      // Programs may have rewritten files with pending changes (formatters, snapshots).
      await env.changes.getState().syncFromDisk(env.project).catch(() => undefined);
    }
    const output = result.output.trim() ? tail(result.output.trimEnd()) : '(no output)';
    const status = result.timedOut
      ? `[stopped after ${COMMAND_TIMEOUT_MS / 1000} s without finishing]`
      : result.code === null
        ? '[done]'
        : `[exit code ${result.code}]`;
    const failed = result.timedOut || (result.code !== null && result.code !== 0);
    return {
      content: `$ ${command}\n${output}\n${status}`,
      isError: failed,
      test: isTestCommand(command) ? { command, code: result.code, timedOut: result.timedOut, summary: testSummary(result.output) } : undefined,
    };
  },
};

const finish: AgentTool = {
  spec: {
    name: 'finish',
    description: 'Call this once the task is done (or cannot be done) with a short summary for the user: what you changed, and the test results if you ran any. This ends your turn.',
    inputSchema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One to four sentences, plain text.' } },
      required: ['summary'],
      additionalProperties: false,
    },
  },
  describe: () => ({ verb: 'Finished', chips: [] }),
  async run(input) {
    return { content: 'Finished.', finish: str(input.summary).trim() };
  },
};

export const AGENT_TOOLS: AgentTool[] = [listFiles, readFile, search, editFile, writeFile, runCommand, finish];

export const toolSpecs = (tools: AgentTool[]) => tools.map((t) => t.spec);
