import type { SessionInfo } from '@shared/protocol';

import type { RemoteSettings } from './settings';
import { SYNC_PROTOCOL } from './syncRules';

export class RemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RemoteError';
  }
}

const authHeaders = (s: RemoteSettings) => ({ authorization: `Bearer ${s.token}` });

// Starts the project's container, or returns the one already running.
export async function openSession(settings: RemoteSettings, project: string, fetchImpl: typeof fetch = fetch): Promise<SessionInfo> {
  let res: Response;
  try {
    res = await fetchImpl(`${settings.url}/sessions`, {
      method: 'POST',
      headers: { ...authHeaders(settings), 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
  } catch {
    throw new RemoteError(`Can't reach ${settings.url}`);
  }
  if (res.status === 401) throw new RemoteError('The server rejected the token');
  if (!res.ok) throw new RemoteError(`The server answered ${res.status}`);
  const info = (await res.json()) as SessionInfo;
  checkProtocol(info);
  return info;
}

// Syncing with a server that follows other rules could lose files, so a
// mismatch stops here with what to update.
export function checkProtocol(info: SessionInfo) {
  const theirs = typeof info.protocol === 'number' ? info.protocol : 1;
  if (theirs < SYNC_PROTOCOL) throw new RemoteError('Your Tide server is out of date. Update it to the latest version (git pull, then restart it) and try again.');
  if (theirs > SYNC_PROTOCOL) throw new RemoteError('Your Tide server is newer than this app. Update Tide from the App Store and try again.');
}

export function socketUrl(settings: RemoteSettings, session: SessionInfo, channel: 'pty' | 'sync') {
  return `${settings.url.replace(/^http/i, 'ws')}/sessions/${session.id}/${channel}`;
}

export function previewUrl(settings: RemoteSettings, session: SessionInfo, port: number) {
  return `${settings.url}${session.previewBase}/${port}/`;
}

// React Native's WebSocket takes headers as a third argument; browsers don't.
export type SocketFactory = (url: string, headers: Record<string, string>) => WebSocket;

export const nativeSocket: SocketFactory = (url, headers) =>
  new (WebSocket as unknown as new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket)(
    url,
    undefined,
    { headers },
  );

export const connectSocket = (factory: SocketFactory, settings: RemoteSettings, session: SessionInfo, channel: 'pty' | 'sync') =>
  factory(socketUrl(settings, session, channel), authHeaders(settings));
