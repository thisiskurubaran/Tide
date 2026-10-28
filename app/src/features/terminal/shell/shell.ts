import type { RunnerMessage, Runtime } from '@shared/protocol';

import type { Runner } from '../../../runtime/runner';
import { basename, dirname, joinPath } from '../../files/fs';
import { WorkspaceError } from '../../files/workspace';
import { ansi } from './ansi';
import { LineEditor } from './lineEditor';
import { displayPath, PathError, resolvePath } from './paths';
import type { ShellFs } from './shellFs';
import { ParseError, tokenize } from './tokenize';

export interface ShellOptions {
  project: string;
  fs: ShellFs;
  runner: Runner;
  write(data: string): void;
  // Where the project lives relative to the Documents directory, for RunRequest paths.
  projectRoot: string;
  newId?: () => string;
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
  ['node <file> [args]', 'run a JavaScript file'],
  ['python <file> [args]', 'run a Python file'],
  ['run', 'run the project (uses tide.json)'],
  ['npm install [pkg...]', 'install pure-JS packages into node_modules'],
  ['pip install <pkg...>', 'install pure-Python packages into .pylibs'],
  ['clear', 'clear the screen'],
  ['help', 'show this list'],
];

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
  private running: { id: string; stdin: LineEditor } | null = null;
  private busy = false;
  // Keys typed while a command is still finishing; replayed at the next prompt, like a real shell.
  private typeahead = '';
  private commands: Record<string, Command>;
  private nextId: () => string;

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
  }

  resize(cols: number) {
    this.cols = Math.max(20, cols);
  }

  input(data: string) {
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

  private prompt() {
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
          `Local mode only has the built-in commands (type help). For git and other tools, switch the terminal to Remote.\n`,
      );
      return;
    }
    if (parsed.redirect && ['node', 'python', 'python3', 'run', 'npm', 'pip', 'pip3'].includes(name)) {
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
        io.out(`${ansi.dim}Anything else (git, packages with native code, ...) needs Remote mode.${ansi.reset}\n`);
      },
      pwd: async (_args, io) => io.out(`${displayPath(this.cwd)}\n`),
      cd: async (args) => {
        if (args.length > 1) throw new CommandError('too many arguments');
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
      node: (args) => this.runProgram('node', args),
      python: (args) => this.runProgram('python', args),
      python3: (args) => this.runProgram('python', args),
      // Built into the Node supervisor; resolves packages from the registry without running scripts.
      npm: (args) => this.startRun('node', 'tide:npm', args, this.cwd),
      // pip downloads with Node's TLS stack; the embedded Python has no CA store on iOS.
      pip: (args) => this.startRun('node', 'tide:pip', args, this.cwd),
      pip3: (args) => this.startRun('node', 'tide:pip', args, this.cwd),
      run: async (args) => {
        if (args.length) throw new CommandError('run takes no arguments; it uses tide.json');
        const config = await fs.readRunConfig();
        if (!config) throw new CommandError('no run config; add a tide.json with "runtime" and "entry"');
        await this.startRun(config.runtime, resolvePath('', config.entry), [], '');
      },
    };
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

  private async startRun(runtime: Runtime, entry: string, args: string[], cwd: string) {
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
    this.running = { id, stdin };
    stdin.read('');

    const root = this.opts.projectRoot;
    // Built-in tools ("tide:npm") are resolved by the runner, not the workspace.
    const entryPath = entry.startsWith('tide:') ? entry : joinPath(root, entry);
    this.opts.runner.run(
      { type: 'run', id, runtime, entry: entryPath, cwd: joinPath(root, cwd), args },
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
        this.running = null;
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
    const wordStart = before.lastIndexOf(' ') + 1;
    const word = before.slice(wordStart);
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
    const completed = before.slice(0, wordStart) + prefix + common;
    return {
      line: completed + line.slice(cursor),
      cursor: completed.length,
      options: options.map((o) => o.trimEnd()),
    };
  }
}
