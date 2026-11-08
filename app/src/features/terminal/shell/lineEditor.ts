import { ansi, visibleLength } from './ansi';

export interface LineEditorHost {
  write(data: string): void;
  submit(line: string): void;
  interrupt(): void;
  clearScreen(): void;
  complete(line: string, cursor: number): Promise<{ line: string; cursor: number; options?: string[] } | null>;
}

export const HISTORY_LIMIT = 500;

// The lines ↑ and ↓ step through, oldest first. The shell's prompt shares one
// per project (saved, see history.ts); other prompts keep their own in memory.
export interface LineHistory {
  readonly entries: readonly string[];
  // Told about each submitted line; decides itself whether to keep it.
  add(line: string): void;
}

// Keeps non-blank lines that differ from the one before, up to `limit`.
export function memoryHistory(limit = HISTORY_LIMIT): LineHistory {
  const entries: string[] = [];
  return {
    entries,
    add(line) {
      if (!line.trim() || entries[entries.length - 1] === line) return;
      entries.push(line);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
    },
  };
}

// Readline-style editing on top of the raw bytes xterm.js sends.
export class LineEditor {
  private buffer = '';
  private cursor = 0;
  private prompt = '';
  // How far back from the newest entry ↑ has gone; 0 is the line being typed.
  // Counted from the end so entries loaded (or added by another terminal)
  // while browsing don't move what ↓ comes back to.
  private historyBack = 0;
  private draft = '';
  private active = false;
  private pendingEscape = '';
  private lastWasTab = false;

  constructor(
    private host: LineEditorHost,
    private history: LineHistory = memoryHistory(),
  ) {}

  // Starts editing a new line. `prompt` may contain color codes.
  read(prompt: string) {
    this.prompt = prompt;
    this.buffer = '';
    this.cursor = 0;
    this.historyBack = 0;
    this.draft = '';
    this.active = true;
    this.host.write(prompt);
  }

  stop() {
    this.active = false;
  }

  get isReading() {
    return this.active;
  }

  get historyEntries(): readonly string[] {
    return this.history.entries;
  }

  // Returns whatever was not consumed because the line was submitted part way
  // through `data` (e.g. a pasted block); the caller replays it at the next prompt.
  input(data: string): string {
    let text = this.pendingEscape + data;
    this.pendingEscape = '';
    while (text.length > 0) {
      if (!this.active) return text;
      const seq = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(text);
      if (seq) {
        this.escape(seq[0]);
        text = text.slice(seq[0].length);
        continue;
      }
      if (text[0] === '\x1b' && text.length < 4 && /^\x1b(\[[0-9;]*|O)?$/.test(text)) {
        // A sequence split across two chunks; wait for the rest.
        this.pendingEscape = text;
        return '';
      }
      this.key(text[0]);
      text = text.slice(1);
    }
    return '';
  }

  private key(c: string) {
    const wasTab = this.lastWasTab;
    this.lastWasTab = false;
    switch (c) {
      case '\r':
      case '\n':
        return this.enter();
      case '\x7f':
      case '\b':
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.redraw();
        }
        return;
      case '\x03':
        this.host.write('^C\n');
        this.active = false;
        return this.host.interrupt();
      case '\x0c':
        this.host.clearScreen();
        this.host.write(this.prompt);
        return this.redraw();
      case '\x01':
        this.cursor = 0;
        return this.redraw();
      case '\x05':
        this.cursor = this.buffer.length;
        return this.redraw();
      case '\x15':
        this.buffer = this.buffer.slice(this.cursor);
        this.cursor = 0;
        return this.redraw();
      case '\x0b':
        this.buffer = this.buffer.slice(0, this.cursor);
        return this.redraw();
      case '\t':
        this.lastWasTab = true;
        return void this.tab(wasTab);
      default:
        if (c >= ' ') {
          this.buffer = this.buffer.slice(0, this.cursor) + c + this.buffer.slice(this.cursor);
          this.cursor++;
          if (this.cursor === this.buffer.length) this.host.write(c);
          else this.redraw();
        }
    }
  }

  private escape(seq: string) {
    switch (seq) {
      case '\x1b[A':
      case '\x1bOA':
        return this.historyMove(-1);
      case '\x1b[B':
      case '\x1bOB':
        return this.historyMove(1);
      case '\x1b[C':
      case '\x1bOC':
        if (this.cursor < this.buffer.length) {
          this.cursor++;
          this.host.write(seq);
        }
        return;
      case '\x1b[D':
      case '\x1bOD':
        if (this.cursor > 0) {
          this.cursor--;
          this.host.write(seq);
        }
        return;
      case '\x1b[H':
      case '\x1bOH':
      case '\x1b[1~':
        this.cursor = 0;
        return this.redraw();
      case '\x1b[F':
      case '\x1bOF':
      case '\x1b[4~':
        this.cursor = this.buffer.length;
        return this.redraw();
      case '\x1b[3~':
        if (this.cursor < this.buffer.length) {
          this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
          this.redraw();
        }
        return;
    }
  }

  private enter() {
    const line = this.buffer;
    this.host.write('\n');
    this.active = false;
    this.history.add(line);
    this.host.submit(line);
  }

  // delta -1 is ↑ (older), 1 is ↓ (newer).
  private historyMove(delta: number) {
    const entries = this.history.entries;
    const back = Math.min(this.historyBack, entries.length) - delta;
    if (back < 0 || back > entries.length) return;
    if (this.historyBack === 0) this.draft = this.buffer;
    this.historyBack = back;
    this.buffer = back === 0 ? this.draft : entries[entries.length - back];
    this.cursor = this.buffer.length;
    this.redraw();
  }

  private async tab(listOptions: boolean) {
    const result = await this.host.complete(this.buffer, this.cursor);
    if (!result || !this.active) return;
    if (result.line !== this.buffer) {
      this.buffer = result.line;
      this.cursor = result.cursor;
      this.redraw();
    } else if (listOptions && result.options && result.options.length > 1) {
      this.host.write(`\n${result.options.join('  ')}\n${this.prompt}`);
      this.redraw();
    }
  }

  // Rewrites the current line. Assumes it fits on one terminal row, which holds
  // for typical commands; long lines still work, they just redraw less neatly.
  private redraw() {
    this.host.write(`\r${this.prompt}${this.buffer}${ansi.clearLine}${ansi.left(this.buffer.length - this.cursor)}`);
  }

  promptWidth() {
    return visibleLength(this.prompt);
  }
}
