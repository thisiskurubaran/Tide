// Connects to a saved server, through an SSH tunnel when it has one: tide:ssh
// forwards a local port to the database as the SSH server sees it, and
// tide:sql, tide:redis or tide:mongo connects to that port.
import { localRunner } from '../../../runtime';
import { startForward } from '../../ssh/client';
import { connectionConfig, rememberKey, sshStore } from '../../ssh/store';
import type { DbSource } from '../source';
import { connectSql } from './client';
import { DbConnection, getPassword } from './connections';
import { remoteSource, SqlKind } from './dialect';
import { connectMongo, mongoBrowser, MongoBrowser } from './mongo';
import { connectRedis, RedisClient } from './redis';

// A port for the tunnel, out of the way of dev servers.
const tunnelPort = () => 41000 + Math.floor(Math.random() * 8000);

function tunnel(conn: DbConnection): Promise<{ port: number; stop: () => void }> {
  const { hosts } = sshStore.getState();
  const host = hosts.find((h) => h.id === conn.sshHostId);
  if (!host) return Promise.reject(new Error('The SSH server for this connection was removed. Edit the connection to pick another.'));
  const port = tunnelPort();
  return connectionConfig(host).then(
    (config) =>
      new Promise((resolve, reject) => {
        let up = false;
        const stop = startForward(localRunner, config, { localPort: port, remoteHost: conn.host, remotePort: conn.port }, {
          status: (text) => {
            if (!up && /^Forwarding/.test(text)) {
              up = true;
              resolve({ port, stop });
            }
          },
          hostKey: (fingerprint, which) => rememberKey(host, fingerprint, which),
          exit: (error) => {
            if (!up) reject(new Error(`SSH (${host.name}): ${error ?? 'the tunnel closed.'}`));
          },
        });
      }),
  );
}

// Runs `connect` against the server or the tunnel's local end; the tunnel
// closes with the returned connection.
async function through<T extends { close(): Promise<void> }>(conn: DbConnection, connect: (host: string, port: number) => Promise<T>): Promise<T> {
  if (conn.sshHostId && !sshStore.getState().loaded) await sshStore.getState().load();
  const t = conn.sshHostId ? await tunnel(conn) : null;
  try {
    const opened = await connect(t ? '127.0.0.1' : conn.host, t ? t.port : conn.port);
    const close = opened.close.bind(opened);
    return Object.assign(opened, {
      close: async () => {
        await close();
        t?.stop();
      },
    });
  } catch (e) {
    t?.stop();
    throw e;
  }
}

export async function openServer(conn: DbConnection): Promise<{ source: DbSource; version: string }> {
  const password = (await getPassword(conn.id)) ?? undefined;
  const client = await through(conn, (host, port) =>
    connectSql(localRunner, { kind: conn.kind as SqlKind, host, port, user: conn.user, password, database: conn.database || undefined, ssl: conn.ssl }),
  );
  return { version: client.version, source: remoteSource(client, conn.kind as SqlKind) };
}

export async function openRedis(conn: DbConnection): Promise<{ client: RedisClient; version: string; db: number }> {
  const password = (await getPassword(conn.id)) ?? undefined;
  const db = Number(conn.database) || 0;
  const client = await through(conn, (host, port) => connectRedis(localRunner, { host, port, user: conn.user || undefined, password, db, ssl: conn.ssl }));
  return { client, version: client.version, db };
}

// A MongoDB server's hosts as the driver wants them: srv names and host lists
// as saved, a single host with its port.
export const mongoHosts = (conn: Pick<DbConnection, 'host' | 'port' | 'srv'>) => (conn.srv || conn.host.includes(',') || /:\d+$/.test(conn.host) ? conn.host : `${conn.host}:${conn.port}`);

export async function openMongo(conn: DbConnection): Promise<{ browser: MongoBrowser; version: string }> {
  if (conn.sshHostId && (conn.srv || conn.host.includes(','))) throw new Error('Through SSH, connect to one host and port of the server, not an srv address or a list.');
  const password = (await getPassword(conn.id)) ?? undefined;
  const client = await through(conn, (host, port) =>
    connectMongo(localRunner, {
      hosts: conn.sshHostId ? `${host}:${port}` : mongoHosts(conn),
      srv: !!conn.srv,
      options: conn.options || undefined,
      user: conn.user || undefined,
      password,
      database: conn.database || undefined,
      ssl: conn.ssl,
      direct: !!conn.sshHostId,
    }),
  );
  return { version: client.version, browser: mongoBrowser(client) };
}
