import type { Duplex } from 'node:stream';

import type { WebSocket } from 'ws';

import type { PtyData, ResizeMsg } from '../../shared/protocol.ts';
import type { Session } from './sessions.ts';

// Real bash in the container. Docker's own TTY exec replaces node-pty: it
// gives a raw byte stream and supports resizing.
export async function attachPty(session: Session, ws: WebSocket, touch: () => void) {
  // The client can type as soon as the socket opens, before the exec exists.
  const early: string[] = [];
  const queue = (raw: unknown) => early.push(String(raw));
  ws.on('message', queue);
  let closed = false;
  ws.once('close', () => (closed = true));

  const exec = await session.container.exec({
    Cmd: ['bash', '-l'],
    User: 'tide',
    WorkingDir: '/workspace',
    Env: ['TERM=xterm-256color', 'LANG=C.UTF-8'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });
  const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as Duplex;
  ws.off('message', queue);
  if (closed) {
    stream.destroy();
    return;
  }

  stream.setEncoding('utf8');
  stream.on('data', (data: string) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pty', data } satisfies PtyData));
  });
  stream.on('end', () => ws.close(1000, 'shell exited'));
  stream.on('error', () => ws.close(1011, 'shell error'));

  // Resize is an HTTP call to Docker; keystrokes after it must wait for it to land.
  let order: Promise<unknown> = Promise.resolve();
  const handle = (raw: unknown) => {
    touch();
    let msg: PtyData | ResizeMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'pty' && typeof msg.data === 'string') {
      const data = msg.data;
      order = order.then(() => void stream.write(data));
    } else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
      const size = { w: Math.min(msg.cols, 500), h: Math.min(msg.rows, 200) };
      order = order.then(() => exec.resize(size)).catch(() => undefined);
    }
  };
  for (const raw of early) handle(raw);
  ws.on('message', handle);
  ws.on('close', () => stream.destroy());
}
