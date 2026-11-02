import { Platform } from 'react-native';

// A WebSocket connection from a .http file: a log of what was sent and
// received, kept until it's closed.
export type WsDirection = 'out' | 'in' | 'info' | 'error';

export interface WsEntry {
  at: number;
  direction: WsDirection;
  text: string;
}

export interface WsLike {
  readyState: number;
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

// React Native's WebSocket takes headers as a third argument; browsers ignore it.
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike;

// iOS (React Native) can send headers with the handshake; browsers can't, and
// reject the extra argument, so the web build connects without them.
const defaultFactory: WsFactory = (u, h) =>
  Platform.OS === 'web'
    ? (new WebSocket(u) as unknown as WsLike)
    : new (WebSocket as unknown as new (u: string, p: undefined, o: { headers: Record<string, string> }) => WsLike)(u, undefined, { headers: h });

const MAX_LOG = 500;
const OPEN = 1;

const describe = (data: unknown) =>
  typeof data === 'string' ? data : data instanceof ArrayBuffer ? `(binary, ${data.byteLength} bytes)` : typeof Blob !== 'undefined' && data instanceof Blob ? `(binary, ${data.size} bytes)` : String(data);

export class WsSession {
  log: WsEntry[] = [];
  state: 'connecting' | 'open' | 'closed' = 'connecting';
  private socket: WsLike;

  constructor(
    url: string,
    headers: [string, string][],
    // Sent once the connection opens.
    private initial: string[],
    // Called with the session on every change, the first time from inside the constructor.
    private onChange: (session: WsSession) => void,
    factory: WsFactory = defaultFactory,
    private now = () => Date.now(),
  ) {
    this.add('info', `Connecting to ${url}`);
    this.socket = factory(url, Object.fromEntries(headers));
    this.socket.onopen = () => {
      this.state = 'open';
      this.add('info', 'Connected');
      for (const m of this.initial) this.send(m);
    };
    this.socket.onmessage = (e) => this.add('in', describe(e.data));
    this.socket.onerror = (e) => this.add('error', e?.message || 'The connection failed.');
    this.socket.onclose = (e) => {
      this.state = 'closed';
      this.add('info', `Closed${e?.code ? ` (${e.code}${e.reason ? `: ${e.reason}` : ''})` : ''}`);
    };
  }

  send(text: string) {
    if (this.socket.readyState !== OPEN) {
      this.add('error', 'Not connected.');
      return;
    }
    this.socket.send(text);
    this.add('out', text);
  }

  close() {
    if (this.state !== 'closed') this.socket.close();
  }

  private add(direction: WsDirection, text: string) {
    this.log = [...this.log, { at: this.now(), direction, text }].slice(-MAX_LOG);
    this.onChange(this);
  }
}
