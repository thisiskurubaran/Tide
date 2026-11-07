import type { RunnerMessage, Runtime } from '@shared/protocol';

import type { Runner } from '../../../runtime/runner';
import { basename, dirname, joinPath } from '../../files/fs';
import { WorkspaceError } from '../../files/workspace';
import { ansi } from './ansi';
import { LineEditor } from './lineEditor';
import { displayPath, PathError, resolvePath } from './paths';
import type { ShellFs } from './shellFs';
import { currentWord, escapeWord, ParseError, tokenize } from './tokenize';
import { DEFAULT_CONFIG, parseTasks } from '../../project/tasks';
import { dotCommand, formatResult, isComplete, runSql, SqliteHost, SqliteOutput } from './sqlite';
import { findPackage, lifecycle, resolveBin, ScriptError, scriptsOf, splitScript, takeEnv } from './npmRun';

export interface ShellOptions {
  project: string;
  fs: ShellFs;
  runner: Runner;
  write(data: string): void;
  // Where the project lives relative to the Documents directory, for RunRequest paths.
  projectRoot: string;
  newId?: () => string;
  // Extra environment for built-in tools, read per run (git's token and identity).
  toolEnv?: () => Record<string, string>;
  // Opens project databases for sqlite3; without it the command says it's unavailable.
  sqlite?: SqliteHost;
  // The project's .env and Keychain variables, given to every program it runs.
  projectEnv?(): Promise<{ values: Record<string, string>; secrets: string[] }>;
  // Told when a program ends, e.g. so a git commit can start an automatic deploy.
  onRunExit?(entry: string, args: string[], code: number): void;
  // Told when a command starts and when the shell is back at its prompt, so
  // the Run button can turn into Stop while something runs.
  onBusy?(busy: boolean): void;
}

class CommandError extends Error {}

type Command = (args: string[], io: Io) => Promise<void>;

interface Io {
  out(text: string): void;
  err(text: string): void;
}

const COMMAND_HELP: [string, string][] = [
  ['ls [-a] [path...]', 'list files'],
  ['cd [dir]', 'change directory (/ is the project root)'],
  ['pwd', 'print the current directory'],
  ['cat <file...>', 'print files'],
  ['echo [text...] [> file]', 'print text, or write it to a file with > or >>'],
  ['touch <file...>', 'create empty files'],
  ['mkdir [-p] <dir...>', 'create folders'],
  ['rm [-r] <path...>', 'delete files, or folders with -r'],
  ['mv <src...> <dest>', 'move or rename'],
  ['cp [-r] <src...> <dest>', 'copy files, or folders with -r'],
  ['node <file> [args]', 'run a JavaScript or TypeScript file (types are stripped, not checked)'],
  ['python <file> [args]', 'run a Python file'],
  ['lua <file> [args]', 'run a Lua file (Lua 5.3)'],
  ['ruby <file> [args]', 'run a Ruby file (Ruby 3.4)'],
  ['php <file> [args]', 'run a PHP file (PHP 8.3)'],
  ['run [name]', 'run the project, or a named configuration (uses tide.json)'],
  ['npm install [pkg...]', 'install pure-JS packages into node_modules'],
  ['npm uninstall <pkg...>', 'remove packages and what only they needed'],
  ['pip install <pkg...>', 'install pure-Python packages into .pylibs'],
  ['git <command>', 'clone, status, add, commit, log, push, pull (git help)'],
  ['env [NAME]', "show the project's environment variables (.env and Keychain)"],
  ['sqlite3 <db> ["SQL"]', 'run SQL on a database file, or open a sqlite> prompt'],
  ['clear', 'clear the screen'],
  ['help', 'show this list'],
];

// TypeScript runs on the same Node: the supervisor strips the types (see
// nodejs-project/typescript), so tsx and ts-node are just node.
export const isTypeScript = (path: string) => /\.(ts|tsx|mts|cts)$/i.test(path) && !/\.d\.[cm]?tsx?$/i.test(path);
const TS_RUNNERS = ['tsx', 'ts-node', 'ts-node-esm'];
// Their options that take a value, dropped along with it; other options are dropped alone.
const TS_RUNNER_VALUE_FLAGS = ['--tsconfig', '-P', '--project', '-r', '--require', '--import', '-C', '--compiler', '-O', '--compilerOptions'];

const errorMessage = (e: unknown) =>
  e instanceof WorkspaceError || e instanceof CommandError || e instanceof PathError || e instanceof ParseError
    ? e.message
    : e instanceof Error
      ? e.message
      : String(e);

// The local mini-shell. iOS can't fork or exec, so this is not a real shell:
// it implements a handful of file commands and hands `node`/`python` to a Runner.
export class Shell {
  private cwd = '';
  private cols = 80;
  private editor: LineEditor;
  private running: { id: string; stdin: LineEditor; entry: string; args: string[] } | null = null;
  // A built-in that reads its own lines (the sqlite> prompt) while it runs.
  private session: LineEditor | null = null;
  private busy = false;
  // Called with each program's exit code (null when it was stopped), for npm run.
  private exitWaiters: ((code: number | null) => void)[] = [];
  // Variables from an npm script's FOO=bar prefix, for the program it starts.
  private stepEnv: Record<string, string> = {};
  // Keys typed while a command is still finishing; replayed at the next prompt, like a real shell.
  private typeahead = '';
  private commands: Record<string, Command>;
  private nextId: () => string;
  // The "not type-checked" note is shown once per terminal.
  private toldNoTypeCheck = false;

  constructor(private opts: ShellOptions) {
    let counter = 0;
    this.nextId = opts.newId ?? (() => `run-${Date.now()}-${++counter}`);
    this.editor = new LineEditor({
      write: (d) => this.write(d),
      submit: (line) => this.execute(line),
      interrupt: () => this.prompt(),
      clearScreen: () => this.write(ansi.clearScreen),
      complete: (line, cursor) => this.complete(line, cursor),
    });
    this.commands = this.buildCommands();
  }

  get currentDirectory() {
    return this.cwd;
  }

  start() {
    this.write(`${ansi.dim}Tide local shell. Type help for commands.${ansi.reset}\n`);
    this.prompt();
  }

  // Stops whatever is running. Programs live in the shared Node runtime, so
  // without this a server would keep running after its terminal is gone.
  dispose() {
    if (this.running) this.opts.runner.send({ type: 'kill', id: this.running.id });
    this.running = null;
    this.settleWaiters(null);
  }

  resize(cols: number) {
    this.cols = Math.max(20, cols);
  }

  input(data: string) {
    if (this.session) {
      this.typeahead += this.session.input(data);
      return;
    }
    if (this.running) {
      this.typeahead += this.running.stdin.input(data);
      return;
    }
    if (this.busy) {
      this.typeahead += data;
      return;
    }
    this.typeahead += this.editor.input(data);
  }

  private write(data: string) {
    this.opts.write(data);
  }

  private reportedBusy = false;
  private reportBusy(busy: boolean) {
    if (busy === this.reportedBusy) return;
    this.reportedBusy = busy;
    this.opts.onBusy?.(busy);
  }

  private prompt() {
    this.reportBusy(false);
    const where = this.cwd ? `/${this.cwd}` : '/';
    this.editor.read(`${ansi.blue}${this.opts.project}${ansi.reset} ${ansi.cyan}${where}${ansi.reset} $ `);
    if (this.typeahead) {
      const pending = this.typeahead;
      this.typeahead = '';
      this.input(pending);
    }
  }

  private async execute(line: string) {
    this.busy = true;
    this.reportBusy(true);
    try {
      await this.runLine(line);
    } finally {
      this.busy = false;
      if (!this.running) this.prompt();
    }
  }

  private async runLine(line: string) {
    let parsed;
    try {
      parsed = tokenize(line);
    } catch (e) {
      this.write(`${ansi.red}tide: ${errorMessage(e)}${ansi.reset}\n`);
      return;
    }
    const [name, ...args] = parsed.args;
    if (!name) return;

    let captured = '';
    const io: Io = parsed.redirect
      ? { out: (t) => (captured += t), err: (t) => this.write(`${ansi.red}${t}${ansi.reset}`) }
      : { out: (t) => this.write(t), err: (t) => this.write(`${ansi.red}${t}${ansi.reset}`) };

    const command = this.commands[name];
    if (!command) {
      this.write(
        `${ansi.red}${name}: command not found${ansi.reset}\n` +
          `Local mode only has the built-in commands (type help). For other tools, switch the terminal to Remote.\n`,
      );
      return;
    }
    if (parsed.redirect && ['node', 'python', 'python3', 'lua', 'ruby', 'php', 'run', 'npm', 'npx', 'pip', 'pip3', 'git', ...TS_RUNNERS].includes(name)) {
      io.err(`${name}: output redirection isn't supported for programs\n`);
      return;
    }
    try {
      await command(args, io);
      if (parsed.redirect) await this.redirect(parsed.redirect.path, captured, parsed.redirect.append);
    } catch (e) {
      io.err(`${name}: ${errorMessage(e)}\n`);
    }
  }

  private async redirect(target: string, text: string, append: boolean) {
    const path = this.resolve(target);
    const kind = await this.opts.fs.stat(path);
    if (kind === 'dir') throw new CommandError(`${target}: is a directory`);
    if (kind === 'file') {
      const before = append ? await this.opts.fs.readFile(path) : '';
      await this.opts.fs.writeFile(path, before + text);
    } else {
      await this.opts.fs.createFile(dirname(path), basename(path), text);
    }
  }

  private resolve(input: string) {
    return resolvePath(this.cwd, input);
  }

  private async requireKind(input: string, kind: 'file' | 'dir') {
    const path = this.resolve(input);
    const found = await this.opts.fs.stat(path);
    if (!found) throw new CommandError(`${input}: no such file or directory`);
    if (found !== kind) throw new CommandError(`${input}: ${kind === 'dir' ? 'not a directory' : 'is a directory'}`);
    return path;
  }

  private flags(args: string[], allowed: string) {
    const set = new Set<string>();
    const rest: string[] = [];
    let done = false;
    for (const a of args) {
      if (!done && a === '--') {
        done = true;
      } else if (!done && a.startsWith('-') && a.length > 1) {
        for (const f of a.slice(1)) {
          if (!allowed.includes(f)) throw new CommandError(`unknown option -${f}`);
          set.add(f);
        }
      } else {
        rest.push(a);
      }
    }
    return { flags: set, rest };
  }

  private formatColumns(names: string[]) {
    if (names.length === 0) return '';
    const plain = (n: string) => n.replace(/\x1b\[[0-9;]*m/g, '');
    const width = Math.max(...names.map((n) => plain(n).length)) + 2;
    const perRow = Math.max(1, Math.floor(this.cols / width));
    let out = '';
    names.forEach((n, i) => {
      const last = (i + 1) % perRow === 0 || i === names.length - 1;
      out += last ? `${n}\n` : n + ' '.repeat(width - plain(n).length);
    });
    return out;
  }

  // `cp a b dir/` style: several sources into a folder, or one source to a new name.
  private async destinations(sources: string[], dest: string) {
    const destPath = this.resolve(dest);
    const destKind = await this.opts.fs.stat(destPath);
    if (sources.length > 1 && destKind !== 'dir') throw new CommandError(`${dest}: not a directory`);
    return sources.map((src) => {
      const from = this.resolve(src);
      return { src, from, to: destKind === 'dir' ? joinPath(destPath, basename(from)) : destPath };
    });
  }

  private buildCommands(): Record<string, Command> {
    const fs = this.opts.fs;
    return {
      help: async (_args, io) => {
        const width = Math.max(...COMMAND_HELP.map(([c]) => c.length)) + 2;
        io.out(COMMAND_HELP.map(([c, d]) => `  ${c.padEnd(width)}${ansi.dim}${d}${ansi.reset}`).join('\n') + '\n');
        io.out(`${ansi.dim}Anything else (packages with native code, other tools) needs Remote mode.${ansi.reset}\n`);
      },
      pwd: async (_args, io) => io.out(`${displayPath(this.cwd)}\n`),
      cd: async (args) => {
        if (args.length > 1) {
          // `cd My Folder` without quotes: take it as one name when that folder exists.
          const joined = args.join(' ');
          if ((await fs.stat(this.resolve(joined))) !== 'dir') throw new CommandError(`too many arguments (put names with spaces in quotes: cd "${joined}")`);
          this.cwd = this.resolve(joined);
          return;
        }
        this.cwd = args.length === 0 ? '' : await this.requireKind(args[0], 'dir');
      },
      ls: async (args, io) => {
        const { flags, rest } = this.flags(args, 'a');
        const targets = rest.length ? rest : ['.'];
        for (const [i, t] of targets.entries()) {
          const path = this.resolve(t);
          const kind = await fs.stat(path);
          if (!kind) throw new CommandError(`${t}: no such file or directory`);
          if (kind === 'file') {
            io.out(`${t}\n`);
            continue;
          }
          if (targets.length > 1) io.out(`${i > 0 ? '\n' : ''}${t}:\n`);
          const entries = (await fs.list(path)).filter((e) => flags.has('a') || !e.name.startsWith('.'));
          io.out(this.formatColumns(entries.map((e) => (e.kind === 'dir' ? `${ansi.blue}${e.name}/${ansi.reset}` : e.name))));
        }
      },
      cat: async (args, io) => {
        if (args.length === 0) throw new CommandError('missing file');
        for (const a of args) {
          const text = await fs.readFile(await this.requireKind(a, 'file'));
          io.out(text.endsWith('\n') || text === '' ? text : `${text}\n`);
        }
      },
      echo: async (args, io) => io.out(`${args.join(' ')}\n`),
      touch: async (args) => {
        if (args.length === 0) throw new CommandError('missing file');
        for (const a of args) {
          const path = this.resolve(a);
          if (!(await fs.stat(path))) await fs.createFile(dirname(path), basename(path), '');
        }
      },
      mkdir: async (args) => {
        const { flags, rest } = this.flags(args, 'p');
        if (rest.length === 0) throw new CommandError('missing folder name');
        for (const a of rest) {
          const path = this.resolve(a);
          if (!path) throw new CommandError(`${a}: already exists`);
          if (flags.has('p')) {
            const parts = path.split('/');
            for (let i = 1; i <= parts.length; i++) {
              const p = parts.slice(0, i).join('/');
              const kind = await fs.stat(p);
              if (kind === 'file') throw new CommandError(`${displayPath(p)}: not a directory`);
              if (!kind) await fs.createFolder(dirname(p), basename(p));
            }
          } else {
            if (await fs.stat(path)) throw new CommandError(`${a}: already exists`);
            await this.requireKind(displayPath(dirname(path)), 'dir');
            await fs.createFolder(dirname(path), basename(path));
          }
        }
      },
      rm: async (args) => {
        const { flags, rest } = this.flags(args, 'rfR');
        const recursive = flags.has('r') || flags.has('R');
        if (rest.length === 0) throw new CommandError('missing operand');
        for (const a of rest) {
          const path = this.resolve(a);
          if (!path) throw new CommandError("refusing to remove the project root; delete the project from the projects list");
          const kind = await fs.stat(path);
          if (!kind) {
            if (flags.has('f')) continue;
            throw new CommandError(`${a}: no such file or directory`);
          }
          if (kind === 'dir' && !recursive) throw new CommandError(`${a}: is a directory (use rm -r)`);
          if (this.cwd === path || this.cwd.startsWith(`${path}/`)) this.cwd = dirname(path);
          await fs.remove(path);
        }
      },
      mv: async (args) => {
        if (args.length < 2) throw new CommandError('usage: mv <src...> <dest>');
        for (const { src, from, to } of await this.destinations(args.slice(0, -1), args[args.length - 1])) {
          if (!(await fs.stat(from))) throw new CommandError(`${src}: no such file or directory`);
          await fs.move(from, to);
          if (this.cwd === from || this.cwd.startsWith(`${from}/`)) this.cwd = to + this.cwd.slice(from.length);
        }
      },
      cp: async (args) => {
        const { flags, rest } = this.flags(args, 'rR');
        if (rest.length < 2) throw new CommandError('usage: cp [-r] <src...> <dest>');
        for (const { src, from, to } of await this.destinations(rest.slice(0, -1), rest[rest.length - 1])) {
          const kind = await fs.stat(from);
          if (!kind) throw new CommandError(`${src}: no such file or directory`);
          if (kind === 'dir' && !flags.has('r') && !flags.has('R')) throw new CommandError(`${src}: is a directory (use cp -r)`);
          await fs.copy(from, to);
        }
      },
      clear: async () => this.write(ansi.clearScreen),
      env: (args, io) => this.printEnv(args, io),
      printenv: (args, io) => this.printEnv(args, io),
      node: (args) => this.runProgram('node', args),
      ...Object.fromEntries(TS_RUNNERS.map((name): [string, Command] => [name, (args) => this.runTsRunner(name, args)])),
      python: (args) => this.runProgram('python', args),
      python3: (args) => this.runProgram('python', args),
      lua: (args) => this.runProgram('lua', args),
      ruby: (args) => this.runProgram('ruby', args),
      php: (args) => this.runProgram('php', args),
      // Built into the Node supervisor; resolves packages from the registry without running scripts.
      npm: (args, io) => this.npm(args, io),
      npx: (args, io) => this.npx(args, io),
      // pip runs in the Node supervisor next to npm, sharing its download and archive code.
      pip: (args) => this.startRun('node', 'tide:pip', args, this.cwd),
      pip3: (args) => this.startRun('node', 'tide:pip', args, this.cwd),
      git: (args) => this.startRun('node', 'tide:git', args, this.cwd, this.opts.toolEnv?.()),
      sqlite3: (args, io) => this.sqlite3(args, io),
      run: async (args) => {
        const raw = await fs.readRunConfig();
        const { configs } = parseTasks(raw ? JSON.stringify(raw) : null);
        if (!configs.length) throw new CommandError('no run config; add a tide.json with "runtime" and "entry"');
        const name = args.join(' ') || DEFAULT_CONFIG;
        const config = configs.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (!config) throw new CommandError(`no configuration named "${name}"; tide.json has ${configs.map((c) => c.name).join(', ')}`);
        await this.startRun(config.runtime, resolvePath('', config.entry), config.args, '');
      },
    };
  }

  private async sqlite3(args: string[], io: Io) {
    const host = this.opts.sqlite;
    if (!host) throw new CommandError('not available in this terminal');
    const [file, ...sql] = args;
    if (!file) throw new CommandError('usage: sqlite3 <database> ["SQL"]');
    const path = this.resolve(file);
    if ((await this.opts.fs.stat(path)) === 'dir') throw new CommandError(`${file}: is a directory`);
    const db = await host.open(path);
    const out: SqliteOutput = { headers: true, mode: 'table' };
    try {
      if (sql.length) {
        io.out(formatResult(await runSql(db, sql.join(' ')), out));
        return;
      }
      io.out(`${ansi.dim}SQLite on ${file}. End statements with ;  .help for commands, .quit to leave.${ansi.reset}\n`);
      await this.readLines('sqlite> ', '   ...> ', async (statement) => {
        if (statement.trim().startsWith('.')) {
          const text = await dotCommand(db, statement, out);
          if (text === null) return false;
          io.out(text);
          return true;
        }
        try {
          io.out(formatResult(await runSql(db, statement), out));
        } catch (e) {
          io.err(`Error: ${errorMessage(e)}\n`);
        }
        return true;
      });
    } finally {
      await db.closeAsync().catch(() => undefined);
      // A new database file, or tables written from SQL, show up in the tree.
      this.opts.fs.refresh().catch(() => undefined);
    }
  }

  // Reads statements at a prompt until `handle` returns false. Lines join
  // until the text is complete (ends with ;); dot commands are single lines.
  private readLines(prompt: string, more: string, handle: (statement: string) => Promise<boolean>) {
    return new Promise<void>((done) => {
      let pending = '';
      const session: LineEditor = new LineEditor({
        write: (d) => this.write(d),
        submit: async (line) => {
          const text = pending ? `${pending}\n${line}` : line;
          if (!text.trim()) return session.read(prompt);
          if (!text.trim().startsWith('.') && !isComplete(text)) {
            pending = text;
            return session.read(more);
          }
          pending = '';
          if (await handle(text)) return session.read(prompt);
          session.stop();
          this.session = null;
          done();
        },
        interrupt: () => {
          pending = '';
          session.read(prompt);
        },
        clearScreen: () => this.write(ansi.clearScreen),
        complete: async () => null,
      });
      this.session = session;
      session.read(prompt);
    });
  }

  private async runProgram(runtime: Runtime, args: string[]) {
    if (runtime === 'python' && args[0] === '-m' && args[1] === 'pip') {
      return this.startRun('node', 'tide:pip', args.slice(2), this.cwd);
    }
    const [file, ...rest] = args;
    if (!file) throw new CommandError(`usage: ${runtime} <file> [args]`);
    const entry = await this.requireKind(file, 'file');
    await this.startRun(runtime, entry, rest, this.cwd);
  }

  // tsx / ts-node <file> [args]: their options don't apply here, and watch mode isn't available.
  private async runTsRunner(name: string, args: string[]) {
    let i = 0;
    for (; i < args.length && args[i].startsWith('-'); i++) {
      if (args[i] === '--') {
        i++;
        break;
      }
      if (TS_RUNNER_VALUE_FLAGS.includes(args[i])) i++;
    }
    if (name === 'tsx' && args[i] === 'watch') throw new CommandError('watch mode needs the Remote terminal; run tsx <file> again after a change');
    if (!args[i]) throw new CommandError(`usage: ${name} <file> [args]`);
    return this.runProgram('node', args.slice(i));
  }

  private async printEnv(args: string[], io: Io) {
    const env = (await this.opts.projectEnv?.().catch(() => null)) ?? { values: {}, secrets: [] };
    const names = args.length ? args : Object.keys(env.values).sort();
    for (const name of names) {
      if (!(name in env.values)) {
        if (args.length) throw new CommandError(`${name} isn't set`);
        continue;
      }
      // Secrets stay hidden here; programs still get the real value.
      const value = env.secrets.includes(name) ? '•••••• (Keychain)' : env.values[name];
      io.out(args.length ? `${value}\n` : `${name}=${value}\n`);
    }
    if (!names.length) io.out('No variables yet. Add them in a .env file, or from the command palette: Environment variables.\n');
  }

  private settleWaiters(code: number | null) {
    const waiters = this.exitWaiters;
    this.exitWaiters = [];
    for (const w of waiters) w(code);
  }

  // The exit code of the program a command started, or 0 when it started none.
  private waitForRun(): Promise<number | null> {
    if (!this.running) return Promise.resolve(0);
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }

  // npm run / test / start run package.json scripts here; everything else
  // (install, uninstall, ls…) goes to the npm built into the Node supervisor.
  private async npm(args: string[], io: Io) {
    const [sub, ...rest] = args;
    const extra = (list: string[]) => (list[0] === '--' ? list.slice(1) : list);
    if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') return this.runScript(rest[0], extra(rest.slice(1)), io);
    if (sub === 'test' || sub === 't' || sub === 'tst') return this.runScript('test', extra(rest), io);
    if (sub === 'start' || sub === 'stop' || sub === 'restart') return this.runScript(sub, extra(rest), io);
    return this.startRun('node', 'tide:npm', args, this.cwd);
  }

  private async npx(args: string[], io: Io) {
    const [bin, ...rest] = args;
    if (!bin) throw new CommandError('usage: npx <command> [args]');
    // tsx and ts-node need native esbuild or a full compiler; Tide's Node runs .ts itself.
    if (TS_RUNNERS.includes(bin)) return this.runTsRunner(bin, rest);
    const pkg = await findPackage(this.opts.fs, this.cwd);
    const path = await resolveBin(this.opts.fs, pkg?.dir ?? '', bin);
    if (!path) throw new CommandError(`${bin} isn't installed in node_modules. Install it with npm install ${bin}; Local mode doesn't download packages on the fly.`);
    io.out('');
    await this.startRun('node', path, rest, this.cwd);
  }

  private async runScript(name: string | undefined, extra: string[], io: Io) {
    let pkg;
    try {
      pkg = await findPackage(this.opts.fs, this.cwd);
    } catch (e) {
      throw new CommandError(errorMessage(e));
    }
    if (!pkg) throw new CommandError('no package.json here or in a parent folder');
    const scripts = scriptsOf(pkg.json);
    if (!name) {
      const names = Object.keys(scripts);
      io.out(names.length ? names.map((n) => `  ${n}\n    ${ansi.dim}${scripts[n]}${ansi.reset}\n`).join('') : 'This package.json has no scripts.\n');
      return;
    }
    let plan = lifecycle(scripts, name, extra);
    // Like npm: start falls back to node server.js.
    if (!plan.length && name === 'start' && (await this.opts.fs.stat(joinPath(pkg.dir, 'server.js'))) === 'file') plan = [{ name, script: 'node server.js' }];
    if (!plan.length) throw new CommandError(`missing script: "${name}". Available: ${Object.keys(scripts).join(', ') || 'none'}`);
    const cwd = this.cwd;
    this.cwd = pkg.dir;
    try {
      for (const step of plan) {
        io.out(`${ansi.dim}> ${step.name}\n> ${step.script}${ansi.reset}\n\n`);
        const code = await this.runScriptLine(step.script, pkg.dir, io);
        if (code === null) return;
        if (code !== 0) {
          io.err(`npm run ${step.name} failed with exit code ${code}\n`);
          return;
        }
      }
    } finally {
      this.cwd = cwd;
    }
  }

  // One script: commands joined with && and ;. Returns its exit code, or null
  // when a program was stopped (Ctrl-C), which ends the whole run.
  private async runScriptLine(script: string, dir: string, io: Io): Promise<number | null> {
    let steps;
    try {
      steps = splitScript(script);
    } catch (e) {
      io.err(`${errorMessage(e)}\n`);
      return 1;
    }
    let last = 0;
    for (const step of steps) {
      if (step.ifOk && last !== 0) continue;
      const code = await this.runScriptStep(step.line, dir, io);
      if (code === null) return null;
      last = code;
    }
    return last;
  }

  private async runScriptStep(line: string, dir: string, io: Io): Promise<number | null> {
    let words: string[];
    try {
      const parsed = tokenize(line);
      if (parsed.redirect) throw new ScriptError(`"${line}": redirects in scripts need the Remote terminal`);
      words = parsed.args;
    } catch (e) {
      io.err(`${errorMessage(e)}\n`);
      return 1;
    }
    const { env, rest } = takeEnv(words);
    const [name, ...args] = rest;
    if (!name) return 0;
    this.stepEnv = env;
    try {
      const command = this.commands[name];
      if (command) await command(args, io);
      else {
        const bin = await resolveBin(this.opts.fs, dir, name);
        if (!bin) {
          io.err(`${name}: not available in Local mode (not a Tide command or a package in node_modules). Run this script in the Remote terminal.\n`);
          return 127;
        }
        await this.startRun('node', bin, args, this.cwd);
      }
      return await this.waitForRun();
    } catch (e) {
      io.err(`${name}: ${errorMessage(e)}\n`);
      return 1;
    } finally {
      this.stepEnv = {};
    }
  }

  private async startRun(runtime: Runtime, entry: string, args: string[], cwd: string, toolEnv?: Record<string, string>) {
    // Programs read the disk: pending autosaves go there first.
    await this.opts.fs.flush().catch((e) => console.warn('Could not save files before running', e));
    const projectEnv = (await this.opts.projectEnv?.().catch(() => null))?.values ?? {};
    const merged = { ...projectEnv, ...this.stepEnv, ...toolEnv };
    const env = Object.keys(merged).length ? merged : undefined;
    const id = this.nextId();
    const stdin = new LineEditor({
      write: (d) => this.write(d),
      submit: (line) => {
        this.opts.runner.send({ type: 'stdin', id, data: `${line}\n` });
        stdin.read('');
      },
      interrupt: () => this.opts.runner.send({ type: 'kill', id }),
      clearScreen: () => this.write(ansi.clearScreen),
      complete: async () => null,
    });
    this.running = { id, stdin, entry, args };
    if (runtime === 'node' && isTypeScript(entry) && !this.toldNoTypeCheck) {
      this.toldNoTypeCheck = true;
      this.write(`${ansi.dim}tide: running TypeScript without type-checking${ansi.reset}\n`);
    }
    stdin.read('');

    const root = this.opts.projectRoot;
    // Built-in tools ("tide:npm") are resolved by the runner, not the workspace.
    const entryPath = entry.startsWith('tide:') ? entry : joinPath(root, entry);
    this.opts.runner.run(
      { type: 'run', id, runtime, entry: entryPath, cwd: joinPath(root, cwd), args, ...(env ? { env } : {}) },
      (msg: RunnerMessage) => this.onRunnerMessage(id, msg),
    );
  }

  private onRunnerMessage(id: string, msg: RunnerMessage) {
    if (!this.running || this.running.id !== id) return;
    switch (msg.type) {
      case 'stdout':
        return this.write(msg.data);
      case 'stderr':
        return this.write(`${ansi.red}${msg.data}${ansi.reset}`);
      case 'exit': {
        this.running.stdin.stop();
        this.opts.onRunExit?.(this.running.entry, this.running.args, msg.code ?? 1);
        this.running = null;
        this.settleWaiters(msg.signal ? null : (msg.code ?? 1));
        // Programs can create or delete files (npm install, scripts writing output).
        this.opts.fs.refresh().catch(() => undefined);
        if (msg.code !== 0 || msg.signal) {
          this.write(`${ansi.dim}[exited with ${msg.signal ? `signal ${msg.signal}` : `code ${msg.code}`}]${ansi.reset}\n`);
        }
        if (!this.busy) this.prompt();
        return;
      }
      case 'pty':
        return this.write(msg.data);
    }
  }

  private async complete(line: string, cursor: number) {
    const before = line.slice(0, cursor);
    const { start: wordStart, text: word, quote } = currentWord(before);
    const isCommand = before.slice(0, wordStart).trim() === '';

    let options: string[];
    let prefix: string;
    if (isCommand) {
      options = Object.keys(this.commands).filter((c) => c.startsWith(word)).map((c) => `${c} `);
      prefix = '';
    } else {
      const slash = word.lastIndexOf('/');
      prefix = word.slice(0, slash + 1);
      const partial = word.slice(slash + 1);
      let dir: string;
      try {
        dir = resolvePath(this.cwd, prefix || '.');
      } catch {
        return null;
      }
      if ((await this.opts.fs.stat(dir)) !== 'dir') return null;
      options = (await this.opts.fs.list(dir))
        .filter((e) => e.name.startsWith(partial) && (partial.startsWith('.') || !e.name.startsWith('.')))
        .map((e) => (e.kind === 'dir' ? `${e.name}/` : `${e.name} `));
    }
    if (options.length === 0) return null;

    let common = options[0];
    for (const o of options) {
      while (!o.startsWith(common)) common = common.slice(0, -1);
    }
    // Names with spaces are escaped, or kept as typed inside an open quote,
    // so the completed line runs as one argument.
    let insert: string;
    if (isCommand) insert = common;
    else if (quote) insert = quote + prefix + (common.endsWith(' ') ? `${common.trimEnd()}${quote} ` : common);
    else insert = escapeWord(prefix) + (common.endsWith(' ') ? `${escapeWord(common.trimEnd())} ` : escapeWord(common));
    const completed = before.slice(0, wordStart) + insert;
    return {
      line: completed + line.slice(cursor),
      cursor: completed.length,
      options: options.map((o) => o.trimEnd()),
    };
  }
}
