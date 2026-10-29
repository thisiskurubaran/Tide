// @ts-check
// Long-lived helpers for the app (formatting, linting, the TypeScript language
// service) run like any other program, in a worker, and talk JSON lines:
// requests {id, method, params} on stdin, replies {id, result} or {id, error}
// on stdout. Notifications from the service have no id.
'use strict';

const readline = require('readline');

/**
 * @param {Record<string, (params: any) => any>} handlers
 * @returns {{ notify(method: string, params: unknown): void }}
 */
function serve(handlers) {
  /** @param {object} msg */
  const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }
    const handler = handlers[req.method];
    try {
      if (!handler) throw new Error(`unknown method ${req.method}`);
      const result = await handler(req.params || {});
      if (req.id !== undefined) write({ id: req.id, result: result === undefined ? null : result });
    } catch (e) {
      const err = /** @type {Error} */ (e);
      if (req.id !== undefined) write({ id: req.id, error: err && err.message ? err.message : String(e) });
    }
  });
  return { notify: (method, params) => write({ method, params }) };
}

module.exports = { serve };
