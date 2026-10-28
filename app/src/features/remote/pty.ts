import type { PtyData, ResizeMsg } from '@shared/protocol';

import type { TerminalBackend } from '../terminal/backend';
import { ansi } from '../terminal/shell/ansi';

// A real bash in the container. Keystrokes go straight through; the
// container's PTY does line editing, history and completion.
export class RemotePty implements TerminalBackend {
  private socket: WebSocket | null = null;
  private size: ResizeMsg | null = null;

  private connect: () => WebSocket;
  private write: (data: string) => void;

  constructor(connect: () => WebSocket, write: (data: string) => void) {
    this.connect = connect;
    this.write = write;
  }

  start() {
    this.write(`${ansi.dim}Connecting to the remote shell...${ansi.reset}\r\n`);
    const socket = this.connect();
    this.socket = socket;
    socket.onopen = () => {
      if (this.size) socket.send(JSON.stringify(this.size));
    };
    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as PtyData;
        if (msg.type === 'pty') this.write(msg.data);
      } catch {
        // Not a message we know.
      }
    };
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const why = e.reason ? `: ${e.reason}` : '';
      this.write(`\r\n${ansi.dim}Remote shell closed${why}. Switch modes or reopen the project to reconnect.${ansi.reset}\r\n`);
    };
  }

  input(data: string) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'pty', data } satisfies PtyData));
  }

  resize(cols: number, rows: number) {
    this.size = { type: 'resize', cols, rows };
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(this.size));
  }

  dispose() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
