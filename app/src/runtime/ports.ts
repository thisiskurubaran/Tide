import { createStore, useStore } from 'zustand';

import type { Runner } from './runner';

// Ports that programs run on the device are listening on, per project, so
// the terminal can offer a preview of them. Runs report them (see worker.js
// and tide_runner.py); a run's ports go away when it exits.
export interface PortsState {
  runs: Record<string, { project: string; ports: number[] }>;
}

export const portsStore = createStore<PortsState>()(() => ({ runs: {} }));

const EMPTY: number[] = [];

export function projectPorts(s: PortsState, project: string): number[] {
  const ports = Object.values(s.runs)
    .filter((r) => r.project === project)
    .flatMap((r) => r.ports);
  return ports.length ? [...new Set(ports)].sort((a, b) => a - b) : EMPTY;
}

export const useLocalPorts = (project: string) => {
  const key = useStore(portsStore, (s) => projectPorts(s, project).join(','));
  return key ? key.split(',').map(Number) : EMPTY;
};

// "projects/<name>/..." -> name
const projectOf = (cwd: string) => (cwd.startsWith('projects/') ? cwd.split('/')[1] : null);

// Wraps a runner to record the ports its runs open.
export function trackPorts(runner: Runner, store = portsStore): Runner {
  const update = (id: string, fn: (ports: number[]) => number[] | null) =>
    store.setState((s) => {
      const run = s.runs[id];
      if (!run) return s;
      const ports = fn(run.ports);
      const runs = { ...s.runs };
      if (ports) runs[id] = { ...run, ports };
      else delete runs[id];
      return { runs };
    });
  return {
    run(req, onMessage) {
      const project = projectOf(req.cwd);
      if (project) store.setState((s) => ({ runs: { ...s.runs, [req.id]: { project, ports: [] } } }));
      runner.run(req, (msg) => {
        if (msg.type === 'port') update(msg.id, (ports) => (msg.open ? [...new Set([...ports, msg.port])] : ports.filter((p) => p !== msg.port)));
        else if (msg.type === 'exit') update(msg.id, () => null);
        onMessage(msg);
      });
    },
    send: (msg) => runner.send(msg),
  };
}
