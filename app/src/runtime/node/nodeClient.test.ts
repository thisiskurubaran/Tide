import { createNodeClient, NodeHost } from './nodeClient';

function fakeHost() {
  let listener: ((msg: string) => void) | undefined;
  const host: NodeHost & { starts: number; emit(msg: string): void; sent: string[] } = {
    starts: 0,
    sent: [],
    start() {
      host.starts++;
    },
    channel: {
      addListener: (_event, cb) => {
        listener = cb;
      },
      send: (msg) => host.sent.push(msg),
    },
    emit: (msg) => listener?.(msg),
  };
  return host;
}

describe('createNodeClient', () => {
  it('waits for ready before sending and resolves with the reply', async () => {
    const host = fakeHost();
    const client = createNodeClient(host);
    const reply = client.request('hi');
    await Promise.resolve();
    expect(host.sent).toEqual([]);
    host.emit('ready');
    await new Promise((r) => setTimeout(r, 0));
    expect(host.sent).toEqual(['hi']);
    host.emit('echo hi');
    await expect(reply).resolves.toBe('echo hi');
  });

  it('starts node only once', async () => {
    const host = fakeHost();
    const client = createNodeClient(host);
    const a = client.request('a');
    const b = client.request('b');
    host.emit('ready');
    await new Promise((r) => setTimeout(r, 0));
    host.emit('ra');
    host.emit('rb');
    await expect(Promise.all([a, b])).resolves.toEqual(['ra', 'rb']);
    expect(host.starts).toBe(1);
  });

  it('rejects when node never replies', async () => {
    const client = createNodeClient(fakeHost(), 20);
    await expect(client.request('x')).rejects.toThrow('did not reply');
  });
});
