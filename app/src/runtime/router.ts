import type { Runtime } from '@shared/protocol';

import type { Runner } from './runner';

// Sends each run to the runner for its runtime and remembers which runner owns
// which run, so stdin and kill reach the right one.
export function createRouter(runners: Record<Runtime, Runner>): Runner {
  const owners = new Map<string, Runner>();
  return {
    run(req, onMessage) {
      const runner = runners[req.runtime];
      owners.set(req.id, runner);
      runner.run(req, (msg) => {
        if (msg.type === 'exit') owners.delete(req.id);
        onMessage(msg);
      });
    },
    send(msg) {
      owners.get(msg.id)?.send(msg);
    },
  };
}
