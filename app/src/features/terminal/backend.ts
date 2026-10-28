// What the terminal pane drives: the local mini-shell or a remote PTY.
export interface TerminalBackend {
  start(): void;
  input(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}
