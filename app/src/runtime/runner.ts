import type { KillMsg, RunnerMessage, RunRequest, StdinMsg } from '@shared/protocol';

// Every runner (local Node, local Python, remote) implements this, so the
// terminal never branches on which one it is talking to.
export interface Runner {
  // `cwd` and `entry` in the request are relative to the app's Documents directory.
  run(req: RunRequest, onMessage: (msg: RunnerMessage) => void): void;
  send(msg: StdinMsg | KillMsg): void;
}

// Used until the local Node and Python runners exist: every run fails with a clear message.
export function createUnavailableRunner(): Runner {
  return {
    run(req, onMessage) {
      const name = req.runtime === 'node' ? 'Node' : 'Python';
      onMessage({ type: 'stderr', id: req.id, data: `Running ${name} on this device isn't available yet.\n` });
      onMessage({ type: 'exit', id: req.id, code: 1 });
    },
    send() {},
  };
}
