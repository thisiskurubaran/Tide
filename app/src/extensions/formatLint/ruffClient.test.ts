import { defaultRuffSettings } from './ruff';
import { ruff, ruffBridge, ruffHostStore } from './ruffClient';
import type { ToRuff } from './ruffProtocol';

it('starts the host, waits for the page and matches replies to requests', async () => {
  const sent: ToRuff[] = [];
  ruffBridge.attach((msg) => sent.push(msg));
  expect(ruffHostStore.getState().wanted).toBe(false);
  const formatted = ruff.format('x=1\n', defaultRuffSettings());
  const checked = ruff.check('import os\n', defaultRuffSettings());
  expect(ruffHostStore.getState().wanted).toBe(true);
  await Promise.resolve();
  expect(sent).toEqual([]);
  ruffBridge.loaded('file:///assets/ruff.wasm');
  await Promise.resolve();
  expect(sent.map((m) => m.type)).toEqual(['init', 'request', 'request']);
  const [, f, c] = sent as Extract<ToRuff, { type: 'request' }>[];
  expect(f).toMatchObject({ method: 'format', content: 'x=1\n', settings: { lint: { select: ['E4', 'E7', 'E9', 'F'] } } });
  ruffBridge.receive({ type: 'reply', id: c.id, error: 'boom' });
  ruffBridge.receive({ type: 'reply', id: f.id, result: 'x = 1\n' });
  await expect(formatted).resolves.toBe('x = 1\n');
  await expect(checked).rejects.toThrow('boom');
  // A crash fails what's in flight and remounts the page.
  const lost = ruff.check('y\n', defaultRuffSettings());
  await Promise.resolve();
  ruffBridge.crashed();
  await expect(lost).rejects.toThrow(/stopped/);
  expect(ruffHostStore.getState().generation).toBe(1);
});
