// @ts-check
// Runs user scripts for the app. nodejs-mobile can start Node only once per app
// process and never restart it, so every run gets its own worker_threads Worker:
// Ctrl-C terminates the worker and Node keeps running for the next run.
'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const BOOTSTRAP = path.join(__dirname, 'worker.js');
const DEFAULT_MAX_MEMORY_MB = 256;
// Servers run until stopped, so there is no timeout unless one is asked for.
const DEFAULT_TIMEOUT_MS = 0;

/**
 * @typedef {{ type: string, [key: string]: unknown }} Message
 * @param {{ send: (msg: object) => void, builtins?: Record<string, string> }} options
 *   `builtins` maps `tide:<name>` entries (e.g. the npm installer) to script paths.
 */
function createSupervisor({ send, builtins = {} }) {
  /** @type {string | null} */
  let root = null;
  /** @type {Map<string, { worker: Worker, killed: boolean, timer: NodeJS.Timeout | null }>} */
  const runs = new Map();

  /** Resolves a root-relative path and refuses anything outside the root. */
  function resolve(rel) {
    if (root === null) throw new Error('supervisor has no root yet');
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path outside the workspace: ${rel}`);
    return abs;
  }

  function fail(id, text) {
    send({ type: 'stderr', id, data: text.endsWith('\n') ? text : `${text}\n` });
    send({ type: 'exit', id, code: 1 });
  }

  /** @param {any} req */
  function run(req) {
    if (runs.has(req.id)) return fail(req.id, `run ${req.id} is already active`);
    let entry;
    let cwd;
    try {
      cwd = resolve(req.cwd || '.');
      entry = typeof req.entry === 'string' && req.entry.startsWith('tide:') ? builtins[req.entry.slice(5)] : resolve(req.entry);
      if (!entry) throw new Error(`unknown built-in ${req.entry}`);
    } catch (e) {
      return fail(req.id, String(/** @type {Error} */ (e).message));
    }

    // Workers can't chdir, but they share the process cwd, so set it here.
    // Runs share one cwd; the terminal only runs one program at a time.
    try {
      process.chdir(cwd);
    } catch (e) {
      return fail(req.id, `can't enter ${req.cwd}: ${/** @type {Error} */ (e).message}`);
    }

    const limits = req.limits || {};
    let worker;
    try {
      worker = new Worker(BOOTSTRAP, {
        argv: Array.isArray(req.args) ? req.args : [],
        workerData: { entry },
        env: { ...process.env, ...(req.env || {}), PWD: cwd },
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: limits.maxMemoryMb || DEFAULT_MAX_MEMORY_MB },
      });
    } catch (e) {
      return fail(req.id, String(/** @type {Error} */ (e).stack || e));
    }

    const state = { worker, killed: false, timer: /** @type {NodeJS.Timeout | null} */ (null) };
    runs.set(req.id, state);
    const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (timeoutMs > 0) {
      state.timer = setTimeout(() => {
        send({ type: 'stderr', id: req.id, data: `\nStopped after ${Math.round(timeoutMs / 1000)}s (time limit).\n` });
        state.killed = true;
        worker.terminate();
      }, timeoutMs);
    }

    worker.stdout.setEncoding('utf8');
    worker.stderr.setEncoding('utf8');
    worker.stdout.on('data', (data) => send({ type: 'stdout', id: req.id, data }));
    worker.stderr.on('data', (data) => send({ type: 'stderr', id: req.id, data }));
    worker.on('error', (err) => {
      // Uncaught exceptions arrive here instead of on stderr.
      const text = err && err.stack ? err.stack : String(err);
      const hint = /ERR_WORKER_OUT_OF_MEMORY/.test(String(err && /** @type {any} */ (err).code))
        ? `\nOut of memory (limit ${limits.maxMemoryMb || DEFAULT_MAX_MEMORY_MB} MB).`
        : '';
      send({ type: 'stderr', id: req.id, data: `${text}${hint}\n` });
    });
    worker.on('exit', (code) => {
      if (state.timer) clearTimeout(state.timer);
      runs.delete(req.id);
      // Let stdout/stderr drain before the exit message so output isn't cut off.
      setImmediate(() =>
        send(state.killed ? { type: 'exit', id: req.id, code: 130, signal: 'SIGINT' } : { type: 'exit', id: req.id, code }),
      );
    });
  }

  /** @param {Message} msg */
  function handle(msg) {
    switch (msg.type) {
      case 'init':
        root = path.resolve(String(msg.root));
        return;
      case 'ping':
        return send({ type: 'pong', node: process.version, platform: process.platform, arch: process.arch });
      case 'run':
        return run(msg);
      case 'stdin': {
        const state = runs.get(String(msg.id));
        if (state) state.worker.postMessage({ stdin: String(msg.data) });
        return;
      }
      case 'kill': {
        const state = runs.get(String(msg.id));
        if (state) {
          state.killed = true;
          state.worker.terminate();
        }
        return;
      }
    }
  }

  return { handle, activeRuns: () => runs.size };
}

module.exports = { createSupervisor, DEFAULT_MAX_MEMORY_MB };
