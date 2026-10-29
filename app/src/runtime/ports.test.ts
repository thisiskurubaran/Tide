/**
 * @jest-environment node
 */
/// <reference types="node" />
import http from 'http';
import { createStore } from 'zustand';

import { stopRuns, supervisorRunner } from '../extensions/testing';
import { PortsState, projectPorts, trackPorts } from './ports';

const cwd = process.cwd();
afterEach(() => {
  stopRuns();
  process.chdir(cwd);
});

const until = (check: () => boolean, timeout = 10_000) =>
  new Promise<void>((resolve, reject) => {
    const start = Date.now();
    const tick = () => (check() ? resolve() : Date.now() - start > timeout ? reject(new Error('timed out')) : setTimeout(tick, 20));
    tick();
  });

it('records the ports a Node server listens on until it closes them or exits', async () => {
  const store = createStore<PortsState>()(() => ({ runs: {} }));
  const supervisor = supervisorRunner();
  supervisor.file(
    'projects/web/server.js',
    `const http = require('http');
     const a = http.createServer((q, s) => s.end('a')).listen(0);
     const b = http.createServer((q, s) => s.end('b')).listen(0);
     process.stdin.on('data', (d) => { if (String(d).trim() === 'close a') a.close(); });`,
  );
  const runner = trackPorts(supervisor, store);
  let exited = false;
  runner.run({ type: 'run', id: 'srv', runtime: 'node', entry: 'projects/web/server.js', cwd: 'projects/web', args: [] }, (m) => {
    if (m.type === 'exit') exited = true;
  });
  await until(() => projectPorts(store.getState(), 'web').length === 2);
  const [first] = projectPorts(store.getState(), 'web');
  expect(projectPorts(store.getState(), 'other')).toEqual([]);

  // The port really serves the page the preview would load.
  const body = await new Promise<string>((resolve, reject) =>
    http.get(`http://127.0.0.1:${first}/`, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve(text));
    }).on('error', reject),
  );
  expect(['a', 'b']).toContain(body);

  runner.send({ type: 'stdin', id: 'srv', data: 'close a\n' });
  await until(() => projectPorts(store.getState(), 'web').length === 1);
  runner.send({ type: 'kill', id: 'srv' });
  await until(() => exited);
  expect(store.getState().runs).toEqual({});
}, 30_000);
