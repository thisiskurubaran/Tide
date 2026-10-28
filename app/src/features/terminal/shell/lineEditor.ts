import { ansi, visibleLength } from './ansi';

export interface LineEditorHost {
  write(data: string): void;
  submit(line: string): void;
  interrupt(): void;
  clearScreen(): void;
  complete(line: string, cursor: number): Promise<{ line: string; cursor: number; options?: string[] } | null>;
}

const HISTORY_LIMIT = 500;

// Readline-style editing on top of the raw bytes xterm.js sends.
export class LineEditor {
  private buffer = '';
  private cursor = 0;
  private prompt = '';
  private history: string[] = [];
  private historyIndex = 0;
  private draft = '';
  private active = false;
  private pendingEscape = '';
  private lastWasTab = false;

  constructor(private host: LineEditorHost) {}

  // Starts editing a new line. `prompt` may contain color codes.
  read(prompt: string) {
    this.prompt = prompt;
    this.buffer = '';
    this.cursor = 0;
    this.historyIndex = this.history.length;
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
    return this.history;
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
    if (line.trim() && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    this.host.submit(line);
  }

  private historyMove(delta: number) {
    const next = this.historyIndex + delta;
    if (next < 0 || next > this.history.length) return;
    if (this.historyIndex === this.history.length) this.draft = this.buffer;
    this.historyIndex = next;
    this.buffer = next === this.history.length ? this.draft : this.history[next];
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
