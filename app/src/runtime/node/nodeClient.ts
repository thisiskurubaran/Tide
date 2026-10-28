export interface NodeChannel {
  addListener(event: 'message', callback: (msg: string) => void): void;
  send(msg: string): void;
}

export interface NodeHost {
  start(script: string): void;
  channel: NodeChannel;
}

// nodejs-mobile can only start once per process, so the client owns that call
// and queues requests until the supervisor reports it is ready.
export function createNodeClient(host: NodeHost, timeoutMs = 10000) {
  let started = false;
  let ready = false;
  let readyWaiters: (() => void)[] = [];
  let pending: ((msg: string) => void)[] = [];

  function ensureStarted() {
    if (started) return;
    started = true;
    host.channel.addListener('message', (msg) => {
      if (!ready && msg === 'ready') {
        ready = true;
        readyWaiters.forEach((w) => w());
        readyWaiters = [];
        return;
      }
      pending.shift()?.(msg);
    });
    host.start('main.js');
  }

  function whenReady(): Promise<void> {
    if (ready) return Promise.resolve();
    return new Promise((resolve) => readyWaiters.push(resolve));
  }

  async function request(msg: string): Promise<string> {
    ensureStarted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Node did not reply within ${timeoutMs} ms`)), timeoutMs);
    });
    const reply = whenReady().then(
      () =>
        new Promise<string>((resolve) => {
          pending.push(resolve);
          host.channel.send(msg);
        }),
    );
    try {
      return await Promise.race([reply, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return { request };
}
