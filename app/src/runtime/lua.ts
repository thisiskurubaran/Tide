import type { Runner } from './runner';

const relative = (from: string, to: string) => {
  const a = from.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || '.';
};

// Lua runs in the Node runtime as the tide:lua built-in (fengari). The script
// path goes in as its first argument, relative to the run's folder.
export function createLuaRunner(node: Runner): Runner {
  return {
    run(req, onMessage) {
      node.run({ ...req, runtime: 'node', entry: 'tide:lua', args: [relative(req.cwd, req.entry), ...req.args] }, onMessage);
    },
    send: (msg) => node.send(msg),
  };
}
