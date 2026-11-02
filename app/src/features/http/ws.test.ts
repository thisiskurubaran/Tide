import { isWebSocket, parseHttpFile, webSocketMessages } from './http';
import { WsLike, WsSession } from './ws';

class FakeSocket implements WsLike {
  readyState = 0;
  sent: string[] = [];
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onerror: WsLike['onerror'] = null;
  onclose: WsLike['onclose'] = null;
  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: 'bye' });
  }
}

describe('WebSocket requests', () => {
  it('parses WEBSOCKET requests and bare ws:// URLs with their messages', () => {
    const { requests } = parseHttpFile('### Chat\nWEBSOCKET wss://x.dev/chat\nAuthorization: Bearer t\n\n{"join":"room"}\n===\nhello\n\n### Echo\nws://localhost:8080/echo\n');
    expect(requests.map((r) => [r.method, r.url, isWebSocket(r)])).toEqual([
      ['WEBSOCKET', 'wss://x.dev/chat', true],
      ['WEBSOCKET', 'ws://localhost:8080/echo', true],
    ]);
    expect(webSocketMessages(requests[0].body)).toEqual(['{"join":"room"}', 'hello']);
    expect(isWebSocket({ method: 'GET', url: 'https://x.dev', headers: [], body: '', name: '', line: 1 })).toBe(false);
  });

  it('connects with headers, sends the first messages, and logs both ways', () => {
    let socket!: FakeSocket;
    let changes = 0;
    const s = new WsSession('wss://x.dev', [['Authorization', 'Bearer t']], ['one', 'two'], () => changes++, (u, h) => (socket = new FakeSocket(u, h)), () => 5);
    expect(socket.headers).toEqual({ Authorization: 'Bearer t' });
    s.send('early');
    expect(s.log.at(-1)).toEqual({ at: 5, direction: 'error', text: 'Not connected.' });
    socket.readyState = 1;
    socket.onopen?.({});
    expect(s.state).toBe('open');
    expect(socket.sent).toEqual(['one', 'two']);
    socket.onmessage?.({ data: 'pong' });
    socket.onmessage?.({ data: new ArrayBuffer(4) });
    s.close();
    expect(s.state).toBe('closed');
    expect(s.log.map((e) => `${e.direction}:${e.text}`)).toEqual([
      'info:Connecting to wss://x.dev',
      'error:Not connected.',
      'info:Connected',
      'out:one',
      'out:two',
      'in:pong',
      'in:(binary, 4 bytes)',
      'info:Closed (1000: bye)',
    ]);
    expect(changes).toBe(s.log.length);
  });
});
