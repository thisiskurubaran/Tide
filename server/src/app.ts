import crypto from 'node:crypto';
import http from 'node:http';

import { type WebSocket, WebSocketServer } from 'ws';

import type { SessionInfo } from '../../shared/protocol.ts';
import type { Config } from './config.ts';
import { handlePreview } from './preview.ts';
import { attachPty } from './pty.ts';
import type { SessionManager } from './sessions.ts';
import { attachSync } from './sync.ts';

const MAX_BODY = 64 * 1024;
export const MAX_MESSAGE = 64 * 1024 * 1024;
// A phone that drops off the network never sends a close frame. Each socket is
// pinged this often and terminated once MAX_MISSED pings in a row went by with
// nothing heard from it, which runs its close handlers (connection count,
// watcher, shell). Any bytes from the client count, not just pongs: on a slow
// uplink a pong queues behind the client's outgoing data (a multi-megabyte
// init batch), and that data still arriving proves the socket is alive.
const HEARTBEAT_MS = 30_000;
const MAX_MISSED = 2;

function authorized(config: Config, header: string | undefined) {
  const given = Buffer.from(header?.replace(/^Bearer /, '') ?? '');
  const expected = Buffer.from(config.token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) req.destroy(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

export function createApp(config: Config, manager: SessionManager, options: { heartbeatMs?: number } = {}) {
  const info = (s: { id: string; project: string; previewKey: string }): SessionInfo => ({
    id: s.id,
    project: s.project,
    previewBase: `/p/${s.previewKey}`,
  });

  const server = http.createServer(async (req, res) => {
    try {
      if (handlePreview(manager, req, res)) return;
      if (req.url === '/health') return json(res, 200, { ok: true });
      if (!authorized(config, req.headers.authorization)) return json(res, 401, { error: 'unauthorized' });

      const m = /^\/sessions(?:\/([A-Za-z0-9_-]+))?$/.exec(req.url ?? '');
      if (!m) return json(res, 404, { error: 'not found' });
      if (req.method === 'POST' && !m[1]) {
        const { project } = await readJson(req);
        if (typeof project !== 'string' || !/^[^/\\\0]{1,128}$/.test(project)) return json(res, 400, { error: 'bad project name' });
        return json(res, 200, info(await manager.open(project)));
      }
      const session = m[1] ? manager.get(m[1]) : undefined;
      if (!session) return json(res, 404, { error: 'no such session' });
      if (req.method === 'GET') return json(res, 200, { ...info(session), ports: session.ports });
      if (req.method === 'DELETE') {
        await manager.remove(session.id);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'method not allowed' });
    } catch (e) {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
      else res.end();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });
  const missed = new WeakMap<WebSocket, number>();
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const n = missed.get(ws) ?? 0;
      if (n >= MAX_MISSED) {
        ws.terminate();
        continue;
      }
      missed.set(ws, n + 1);
      ws.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/sessions\/([A-Za-z0-9_-]+)\/(pty|sync)$/.exec(req.url ?? '');
    const session = m ? manager.get(m[1]) : undefined;
    if (!m || !session || !authorized(config, req.headers.authorization)) {
      socket.end(`HTTP/1.1 ${session ? 401 : 404} ${session ? 'Unauthorized' : 'Not Found'}\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const alive = () => missed.set(ws, 0);
      alive();
      ws.on('pong', alive);
      ws.on('message', alive);
      // Raw bytes too, so a big message still uploading counts before it completes.
      socket.on('data', alive);
      session.connections++;
      manager.touch(session);
      ws.on('close', () => {
        session.connections--;
        manager.touch(session);
      });
      const touch = () => manager.touch(session);
      const attach = m[2] === 'pty' ? attachPty(manager, session, ws, touch) : Promise.resolve(attachSync(manager, session, ws, touch));
      attach.catch((e: Error) => ws.close(1011, e.message.slice(0, 100)));
    });
  });

  return server;
}
