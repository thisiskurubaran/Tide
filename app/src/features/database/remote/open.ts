// Connects to a saved server, through an SSH tunnel when it has one: tide:ssh
// forwards a local port to the database as the SSH server sees it, and tide:sql
// connects to that port.
import { localRunner } from '../../../runtime';
import { startForward } from '../../ssh/client';
import { connectionConfig, rememberKey, sshStore } from '../../ssh/store';
import type { DbSource } from '../source';
import { connectSql } from './client';
import { DbConnection, getPassword } from './connections';
import { remoteSource } from './dialect';

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

export async function openServer(conn: DbConnection): Promise<{ source: DbSource; version: string }> {
  if (conn.sshHostId && !sshStore.getState().loaded) await sshStore.getState().load();
  const t = conn.sshHostId ? await tunnel(conn) : null;
  try {
    const client = await connectSql(localRunner, {
      kind: conn.kind,
      host: t ? '127.0.0.1' : conn.host,
      port: t ? t.port : conn.port,
      user: conn.user,
      password: (await getPassword(conn.id)) ?? undefined,
      database: conn.database || undefined,
      ssl: conn.ssl,
    });
    const source = remoteSource(client, conn.kind);
    return {
      version: client.version,
      source: {
        ...source,
        close: async () => {
          await source.close();
          t?.stop();
        },
      },
    };
  } catch (e) {
    t?.stop();
    throw e;
  }
}
