import type { SessionInfo } from '@shared/protocol';

import type { RemoteSettings } from './settings';

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
  return (await res.json()) as SessionInfo;
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
