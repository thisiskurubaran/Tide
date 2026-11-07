// Stand-ins for the Keychain and the app's file storage in the AI tests:
//   jest.mock('expo-secure-store', () => require('./testMocks').secureStoreMock());
//   jest.mock('../../state', () => require('./testMocks').stateMock());

export function secureStoreMock() {
  const items = new Map<string, string>();
  return {
    __items: items,
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
}

export function stateMock() {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createFsStorage } = jest.requireActual('../../state/storage');
  const { createSettingsStore } = jest.requireActual('../../state/settings');
  const { useStore } = jest.requireActual('zustand');
  const storage = createFsStorage(createMemoryFs());
  const settingsStore = createSettingsStore(storage);
  return { storage, settingsStore, useSettings: (sel: (s: unknown) => unknown) => useStore(settingsStore, sel) };
}

// A fetch that records requests and answers from `reply`.
export function fakeFetch(reply: (url: string, body: any, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; headers: Headers; body: any; method: string }[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, headers: new Headers(init.headers), body, method: init.method ?? 'GET' });
    return reply(url, body, init);
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Server-sent events, with each event as its own chunk.
export function sse(events: (string | { event?: string; data: unknown })[]) {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) {
        const text = typeof e === 'string' ? `data: ${e}\n\n` : `${e.event ? `event: ${e.event}\n` : ''}data: ${JSON.stringify(e.data)}\n\n`;
        c.enqueue(enc.encode(text));
      }
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
