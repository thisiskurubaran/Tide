import http from 'node:http';

import type { SessionManager } from './sessions.ts';

const PREFIX = /^\/p\/([A-Za-z0-9_-]+)\/(\d{1,5})(\/.*)?$/;

// Proxies /p/<previewKey>/<port>/<path> to that port inside the session's
// container. Apps that link to "/" absolutely will leave the prefix; the
// subdomain form in PLAN.md avoids that once there is a real domain.
export function handlePreview(manager: SessionManager, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://x');
  const m = PREFIX.exec(url.pathname);
  if (!m) return false;
  const session = manager.byPreviewKey(m[1]);
  const port = Number(m[2]);
  if (!session) {
    res.writeHead(404).end('No such preview');
    return true;
  }
  if (!m[3]) {
    // Relative links in the page resolve against the trailing slash.
    res.writeHead(302, { location: `${url.pathname}/${url.search}` }).end();
    return true;
  }
  manager.touch(session);
  const fail = () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end(`Nothing is listening on port ${port} in the container.`);
  };
  // http.request only takes a socket synchronously, so open the relay first.
  manager.connect(session, port).then((socket) => {
    // A one-off agent: newer Node ignores createConnection when agent is false.
    const agent = new http.Agent();
    agent.createConnection = () => socket as never;
    const upstream = http.request({
      method: req.method,
      path: `${m[3]}${url.search}`,
      headers: { ...req.headers, host: `localhost:${port}`, connection: 'close' },
      agent,
    });
    upstream.on('response', (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', fail);
    req.pipe(upstream);
  }, fail);
  return true;
}
