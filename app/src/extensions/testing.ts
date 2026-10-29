/// <reference types="node" />
// Test helpers: the real Node supervisor as a Runner, on the host's Node, and
// the Python tools through the host's python3. Only imported by tests.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { RunnerMessage } from '@shared/protocol';
import type { Runner } from '../runtime/runner';

const project = path.join(__dirname, '..', '..', 'nodejs-assets', 'nodejs-project');

export function supervisorRunner(): Runner & { root: string; file(rel: string, content: string): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createSupervisor } = require(path.join(project, 'supervisor'));
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tide-ext-')));
  const listeners = new Map<string, (msg: RunnerMessage) => void>();
  const supervisor = createSupervisor({
    send: (msg: RunnerMessage & { id?: string }) => {
      if (msg.id) listeners.get(msg.id)?.(msg);
    },
    builtins: {
      format: path.join(project, 'format', 'service.js'),
      intellisense: path.join(project, 'intellisense', 'service.js'),
    },
  });
  supervisor.handle({ type: 'init', root });
  return {
    root,
    run(req, onMessage) {
      listeners.set(req.id, onMessage);
      supervisor.handle(req);
    },
    send: (msg) => supervisor.handle(msg),
    file(rel, content) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    },
  };
}

// The generated service bundles, built if a checkout hasn't run npm install's postinstall.
export function ensureServiceBundles() {
  if (!fs.existsSync(path.join(project, 'format', 'bundle.js')) || !fs.existsSync(path.join(project, 'intellisense', 'typescript.js'))) {
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'build-services.js')], { stdio: 'ignore' });
  }
}

const pythonDir = path.join(__dirname, '..', '..', 'modules', 'python-runtime', 'python');

export function hostPython(): string | null {
  for (const bin of ['python3', '/opt/homebrew/bin/python3', '/usr/bin/python3']) {
    try {
      if (execFileSync(bin, ['-c', 'import sys; print(sys.version_info >= (3, 10))']).toString().trim() === 'True') return bin;
    } catch {
      // try the next one
    }
  }
  return null;
}

export const pythonToolsInstalled = () => fs.existsSync(path.join(pythonDir, 'pyflakes')) && fs.existsSync(path.join(pythonDir, 'autopep8.py'));

// tide_runner.snippet, as the native module calls it.
export function hostSnippet(python: string) {
  return async (code: string) => {
    const script = 'import sys; sys.path.insert(0, sys.argv[1]); import tide_runner; sys.stdout.write(tide_runner.snippet(sys.stdin.read()))';
    const result = spawnSync(python, ['-I', '-c', script, pythonDir], { input: code, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout;
  };
}
