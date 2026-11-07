/**
 * @jest-environment node
 */
/// <reference types="node" />
// WsSession against a real WebSocket server (the ws package), through Node's
// client. The package's Node files are required directly: under the React
// Native preset, 'ws' resolves to its browser stub.
/* eslint-disable @typescript-eslint/no-require-imports */
const WebSocketServer = require('ws/lib/websocket-server.js');
const NodeWs = require('ws/lib/websocket.js');

import { WsLike, WsSession } from './ws';

it('talks to a real echo server', async () => {
  const server = new WebSocketServer({ port: 0 });
  server.on('connection', (sock: any, req: any) => {
    sock.send(`hello ${req.headers['x-user'] ?? 'nobody'}`);
    sock.on('message', (m: Buffer) => sock.send(`echo: ${m}`));
  });
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  const s = new WsSession(
    `ws://127.0.0.1:${port}`,
    [['X-User', 'ada']],
    ['first'],
    (session) => {
      if (session.log.filter((e) => e.direction === 'in').length === 3) done();
    },
    (u, h) => new NodeWs(u, { headers: h }) as unknown as WsLike,
  );
  await new Promise((r) => setTimeout(r, 200));
  s.send('second');
  await finished;
  s.close();
  await new Promise((r) => setTimeout(r, 100));
  expect(s.log.filter((e) => e.direction === 'in').map((e) => e.text)).toEqual(['hello ada', 'echo: first', 'echo: second']);
  expect(s.state).toBe('closed');
  server.close();
});
