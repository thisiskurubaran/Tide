// Signing in to GitHub with the device flow: Tide shows a short code, the
// user enters it at github.com/login/device, and Tide polls for the token.
// Only the OAuth App's client ID is needed; there is no secret in the app.
export const GITHUB_CLIENT_ID = process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID ?? '';

// repo: clone, push, pull requests and issues (public and private).
// workflow: re-run Actions. read:org: repositories in the user's organizations.
export const SCOPES = 'repo workflow read:org';

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

const post = async (fetchImpl: typeof fetch, url: string, body: Record<string, string>) => {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description ?? data.message ?? `GitHub answered ${res.status}`);
  return data;
};

export async function startDeviceFlow(clientId = GITHUB_CLIENT_ID, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<DeviceCode> {
  const data = await post(fetchImpl, 'https://github.com/login/device/code', { client_id: clientId, scope: SCOPES });
  if (data.error) throw new Error(data.error_description ?? data.error);
  return data as DeviceCode;
}

export type PollResult = { token: string } | { wait: number } | { error: string };

// One poll. `wait` is the interval to use before the next one.
export async function pollDeviceFlow(code: DeviceCode, interval: number, clientId = GITHUB_CLIENT_ID, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<PollResult> {
  const data = await post(fetchImpl, 'https://github.com/login/oauth/access_token', {
    client_id: clientId,
    device_code: code.device_code,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (data.access_token) return { token: data.access_token };
  switch (data.error) {
    case 'authorization_pending':
      return { wait: interval };
    case 'slow_down':
      return { wait: (data.interval ?? interval + 5) as number };
    case 'expired_token':
      return { error: 'The code expired. Start again.' };
    case 'access_denied':
      return { error: 'Sign-in was cancelled on GitHub.' };
    default:
      return { error: data.error_description ?? data.error ?? 'GitHub sign-in failed.' };
  }
}

// Polls until the user finishes on github.com, the code expires, or `cancelled` says stop.
export async function waitForToken(
  code: DeviceCode,
  cancelled: () => boolean,
  sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000)),
  poll = pollDeviceFlow,
): Promise<string | null> {
  let interval = code.interval || 5;
  const deadline = Date.now() + code.expires_in * 1000;
  while (!cancelled() && Date.now() < deadline) {
    await sleep(interval);
    if (cancelled()) return null;
    const r = await poll(code, interval);
    if ('token' in r) return r.token;
    if ('error' in r) throw new Error(r.error);
    interval = r.wait;
  }
  if (cancelled()) return null;
  throw new Error('The code expired. Start again.');
}
