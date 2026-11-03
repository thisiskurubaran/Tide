// run_command's executor: a hidden local shell, one per command, the same
// Shell the terminal uses. It types the command, captures what it prints, and
// waits for the prompt to come back (busy → false) or the timeout.
import type { CommandResult, CommandRunner } from './tools';

export interface HiddenShell {
  start(): void;
  input(data: string): void;
  dispose(): void;
}

export interface HiddenShellHooks {
  write(data: string): void;
  onBusy(busy: boolean): void;
  onRunExit(entry: string, args: string[], code: number): void;
}

const stripAnsi = (s: string) =>
  s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r\n?/g, '\n');

// The shell echoes the typed line first; drop it so the output starts with the program's.
function withoutEcho(output: string, command: string): string {
  const nl = output.indexOf('\n');
  if (nl >= 0 && output.slice(0, nl).includes(command)) return output.slice(nl + 1);
  return output;
}

// Most built-ins print errors like "cat: x: no such file"; a missing command is 127, like sh.
const notFound = (output: string) => /^[^\n:]+: command not found/m.test(output);

export function createShellCommandRunner(makeShell: (hooks: HiddenShellHooks) => HiddenShell): CommandRunner {
  return {
    run(command, { signal, timeoutMs }) {
      return new Promise<CommandResult>((resolve) => {
        let output = '';
        let sawBusy = false;
        let code: number | null = null;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const line = command.replace(/[\r\n]+/g, ' ').trim();

        const done = (timedOut: boolean) => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          // Stops a program that is still running (timeout or Stop).
          shell.dispose();
          const text = withoutEcho(stripAnsi(output), line);
          resolve({ output: text, code: code ?? (notFound(text) ? 127 : null), timedOut });
        };
        const onAbort = () => {
          output += '\n[stopped]\n';
          done(false);
        };

        let capturing = false;
        const shell = makeShell({
          write: (d) => {
            if (capturing && !settled) output += d;
          },
          onBusy: (busy) => {
            if (busy) sawBusy = true;
            // The prompt is printed right after this, so it isn't captured.
            else if (sawBusy) done(false);
          },
          onRunExit: (_entry, _args, c) => {
            code = c;
          },
        });
        shell.start();
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => done(true), timeoutMs);
        capturing = true;
        shell.input(`${line}\r`);
        // An empty line never goes busy.
        if (!sawBusy) Promise.resolve().then(() => !sawBusy && done(false));
      });
    },
  };
}
