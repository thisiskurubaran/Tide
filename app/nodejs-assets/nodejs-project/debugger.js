// @ts-check
// Debugs runs in their worker threads from the supervisor's main thread, over
// the inspector's NodeWorker domain: a paused worker doesn't block the main
// thread, so commands keep flowing. Speaks the app's DebugCommand/DebugEvent
// (shared/protocol.ts) and translates to and from the Chrome DevTools Protocol.
'use strict';

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MAX_PROPERTIES = 200;

/**
 * @param {{ send(msg: object): void, root(): string }} options
 */
function createDebugger({ send, root }) {
  /** @type {import('inspector').Session | null} */
  let session = null;
  /** Debug runs by worker thread id, waiting to attach or attached. */
  const byThread = new Map();
  /** Debug runs by run id. */
  const runs = new Map();

  const post = (/** @type {string} */ method, params = {}) =>
    new Promise((resolve, reject) => {
      /** @type {any} */ (session).post(method, params, (/** @type {Error | null} */ err, /** @type {any} */ result) =>
        err ? reject(err) : resolve(result),
      );
    });

  function ensureSession() {
    if (session) return;
    const inspector = require('inspector');
    session = new inspector.Session();
    session.connect();
    session.on('NodeWorker.attachedToWorker', ({ params }) => attached(params));
    session.on('NodeWorker.receivedMessageFromWorker', ({ params }) => {
      const run = [...runs.values()].find((r) => r.sessionId === params.sessionId);
      if (run) run.receive(JSON.parse(params.message));
    });
  }

  /** Every worker started while a debug run is starting waits for us; only debug runs stay attached. */
  async function attached(params) {
    const run = byThread.get(Number(params.workerInfo.workerId));
    if (!run) {
      const message = JSON.stringify({ id: 1, method: 'Runtime.runIfWaitingForDebugger' });
      await post('NodeWorker.sendMessageToWorker', { sessionId: params.sessionId, message }).catch(() => undefined);
      await post('NodeWorker.detach', { sessionId: params.sessionId }).catch(() => undefined);
      return;
    }
    run.sessionId = params.sessionId;
    await run.start();
  }

  // Scripts load from their real path, which on iOS can differ from the root the app gave (/var vs /private/var).
  const fileOf = (/** @type {string} */ url) => {
    if (!url.startsWith('file:')) return null;
    const abs = fileURLToPath(url);
    let real = root();
    try {
      real = fs.realpathSync(real);
    } catch {
      // keep the root as given
    }
    for (const base of [root() + path.sep, real + path.sep]) {
      if (abs.startsWith(base)) return abs.slice(base.length).split(path.sep).join('/');
    }
    return null;
  };

  const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** @param {any} o a CDP RemoteObject */
  function describe(o) {
    if (o.type === 'undefined') return 'undefined';
    if (o.subtype === 'null') return 'null';
    if (o.type === 'string') return JSON.stringify(o.value);
    if ('unserializableValue' in o) return o.unserializableValue;
    if ('value' in o && o.type !== 'object') return String(o.value);
    return o.description || o.className || o.type;
  }

  /**
   * Called just before the supervisor creates the worker for a debug run.
   * @param {string} id run id
   * @param {Record<string, number[]>} breakpoints root-relative file -> 1-based lines
   */
  async function prepare(id, breakpoints) {
    ensureSession();
    if (runs.size === 0) await post('NodeWorker.enable', { waitForDebuggerOnStart: true });

    let next = 0;
    /** @type {Map<number, { resolve(v: any): void, reject(e: Error): void }>} */
    const pending = new Map();
    /** handle -> CDP objectId, valid while paused */
    let handles = new Map();
    /** @type {any[]} */
    let callFrames = [];
    /** file -> CDP breakpoint ids */
    const setIds = new Map();
    /** scriptId -> url; call frames' own url field is empty in current V8. */
    const scripts = new Map();

    /** @type {() => void} */
    let markReady = () => undefined;
    const run = {
      id,
      thread: -1,
      sessionId: '',
      // Settles once attached with the initial breakpoints set; commands wait for it.
      ready: new Promise((resolve) => {
        markReady = () => resolve(undefined);
      }),
      /** @param {string} method */
      call(method, params = {}) {
        const msgId = ++next;
        const message = JSON.stringify({ id: msgId, method, params });
        return new Promise((resolve, reject) => {
          pending.set(msgId, { resolve, reject });
          post('NodeWorker.sendMessageToWorker', { sessionId: run.sessionId, message }).catch(reject);
        });
      },
      handle(objectId) {
        const ref = handles.size + 1;
        handles.set(ref, objectId);
        return ref;
      },
      async setBreakpoints(/** @type {string} */ file, /** @type {number[]} */ lines) {
        for (const bp of setIds.get(file) || []) await run.call('Debugger.removeBreakpoint', { breakpointId: bp }).catch(() => undefined);
        const ids = [];
        // By path suffix, for the same reason as fileOf.
        const urlRegex = `(^|/)${escape(file)}$`;
        for (const line of lines) {
          const r = await run.call('Debugger.setBreakpointByUrl', { urlRegex, lineNumber: line - 1, columnNumber: 0 }).catch(() => null);
          if (r) ids.push(r.breakpointId);
        }
        setIds.set(file, ids);
      },
      async start() {
        await run.call('Runtime.enable');
        await run.call('Debugger.enable');
        // No pausing on exceptions: Node runs the script inside its own try/catch, so V8
        // can't tell an uncaught one from a caught one until it is rethrown in Node's code.
        for (const [file, lines] of Object.entries(breakpoints || {})) await run.setBreakpoints(file, lines);
        markReady();
        await run.call('Runtime.runIfWaitingForDebugger');
      },
      /** @param {any} msg */
      receive(msg) {
        if (msg.id !== undefined) {
          const p = pending.get(msg.id);
          pending.delete(msg.id);
          if (!p) return;
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
          return;
        }
        if (msg.method === 'Debugger.scriptParsed') {
          if (msg.params.url) scripts.set(msg.params.scriptId, msg.params.url);
          return;
        }
        if (msg.method === 'Debugger.paused') {
          const { reason, callFrames: frames } = msg.params;
          // The worker stops on its first statement because it waited for us; carry on.
          if (reason === 'Break on start') {
            run.call('Debugger.resume').catch(() => undefined);
            return;
          }
          callFrames = frames;
          handles = new Map();
          send({
            type: 'debug',
            id,
            event: {
              event: 'stopped',
              reason: reason === 'other' ? 'breakpoint' : reason,
              frames: frames.map((/** @type {any} */ f) => ({
                name: f.functionName || '(anonymous)',
                file: fileOf(scripts.get(f.location.scriptId) || f.url || ''),
                line: f.location.lineNumber + 1,
                column: (f.location.columnNumber || 0) + 1,
                scopes: f.scopeChain
                  .filter((/** @type {any} */ s) => s.object && s.object.objectId)
                  .map((/** @type {any} */ s) => ({ name: s.type[0].toUpperCase() + s.type.slice(1), ref: run.handle(s.object.objectId) })),
              })),
            },
          });
        } else if (msg.method === 'Debugger.resumed') {
          callFrames = [];
          send({ type: 'debug', id, event: { event: 'resumed' } });
        }
      },
      /** @param {any} command */
      async command(command) {
        switch (command.cmd) {
          case 'setBreakpoints':
            return run.setBreakpoints(command.file, command.lines);
          case 'continue':
            return run.call('Debugger.resume');
          case 'pause':
            return run.call('Debugger.pause');
          case 'stepOver':
            return run.call('Debugger.stepOver');
          case 'stepInto':
            return run.call('Debugger.stepInto');
          case 'stepOut':
            return run.call('Debugger.stepOut');
          case 'variables': {
            const objectId = handles.get(command.ref);
            /** @type {object[]} */
            let variables = [];
            if (objectId) {
              const { result } = await run.call('Runtime.getProperties', { objectId, ownProperties: true });
              variables = result
                .filter((/** @type {any} */ p) => p.value && p.name !== '__proto__')
                .slice(0, MAX_PROPERTIES)
                .map((/** @type {any} */ p) => ({
                  name: p.name,
                  value: describe(p.value),
                  type: p.value.subtype || p.value.type,
                  ref: p.value.objectId && p.value.type === 'object' ? run.handle(p.value.objectId) : 0,
                }));
            }
            return send({ type: 'debug', id, event: { event: 'variables', req: command.req, variables } });
          }
          case 'evaluate': {
            const frame = callFrames[command.frame || 0];
            const r = frame
              ? await run.call('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: command.expression })
              : await run.call('Runtime.evaluate', { expression: command.expression });
            const event = r.exceptionDetails
              ? { event: 'evaluated', req: command.req, error: r.exceptionDetails.exception ? describe(r.exceptionDetails.exception) : r.exceptionDetails.text }
              : {
                  event: 'evaluated',
                  req: command.req,
                  result: {
                    name: command.expression,
                    value: describe(r.result),
                    type: r.result.subtype || r.result.type,
                    ref: r.result.objectId && r.result.type === 'object' ? run.handle(r.result.objectId) : 0,
                  },
                };
            return send({ type: 'debug', id, event });
          }
        }
      },
    };
    runs.set(id, run);
    return run;
  }

  return {
    prepare,
    /** The worker for a prepared run now exists. */
    started(/** @type {string} */ id, /** @type {number} */ threadId) {
      const run = runs.get(id);
      if (!run) return;
      run.thread = threadId;
      byThread.set(threadId, run);
    },
    command(/** @type {string} */ id, /** @type {any} */ command) {
      const run = runs.get(id);
      if (!run) return;
      // Commands sent before the worker attached (a breakpoint set right after starting) wait for it.
      run.ready.then(() => run.command(command)).catch((/** @type {Error} */ e) => {
        if (command.req !== undefined) send({ type: 'debug', id, event: { event: 'evaluated', req: command.req, error: e.message } });
      });
    },
    // A worker paused in the debugger can't be terminated: detaching resumes it first.
    async release(/** @type {string} */ id) {
      const run = runs.get(id);
      if (run && run.sessionId) await post('NodeWorker.detach', { sessionId: run.sessionId }).catch(() => undefined);
    },
    async ended(/** @type {string} */ id) {
      const run = runs.get(id);
      if (!run) return;
      runs.delete(id);
      byThread.delete(run.thread);
      // Back to normal: workers stop waiting for a debugger.
      if (runs.size === 0 && session) await post('NodeWorker.disable').catch(() => undefined);
    },
  };
}

module.exports = { createDebugger };
