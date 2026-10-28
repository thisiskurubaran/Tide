/**
 * @jest-environment node
 */
/// <reference types="node" />
// Runs the Python unit tests for tide_runner.py so `npm test` covers them.
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';

function findPython(): string | null {
  for (const bin of ['python3', '/opt/homebrew/bin/python3', '/usr/bin/python3']) {
    try {
      const version = execFileSync(bin, ['-c', 'import sys; print(sys.version_info >= (3, 10))']).toString().trim();
      if (version === 'True') return bin;
    } catch {
      // try the next one
    }
  }
  return null;
}

const python = findPython();
const run = python ? it : it.skip;

run('tide_runner.py passes its Python tests', () => {
  const result = spawnSync(python!, ['-m', 'unittest', 'discover', '-s', 'tests'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  expect(result.stderr).toMatch(/OK/);
});
