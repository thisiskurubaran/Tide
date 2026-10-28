// @ts-check
// Bootstrap that every run starts in. Its job is stdin: a worker's built-in
// stdin keeps the worker alive forever, even after readline closes it, while a
// real process exits once nothing reads stdin. So stdin is fed from parentPort
// here, and the port only holds the worker open while someone is reading.
'use strict';

const Module = require('module');
const { Readable } = require('stream');
const { parentPort, workerData } = require('worker_threads');

if (!parentPort) throw new Error('worker.js must run in a worker thread');
const port = parentPort;

const stdin = new Readable({ read() {} });
stdin.setEncoding('utf8');
let reading = false;
const sync = () => {
  const want = stdin.readableFlowing === true || stdin.listenerCount('readable') > 0;
  if (want === reading) return;
  reading = want;
  if (want) port.ref();
  else port.unref();
};
stdin.on('resume', sync);
stdin.on('pause', sync);
stdin.on('newListener', () => setImmediate(sync));
stdin.on('removeListener', () => setImmediate(sync));
Object.defineProperty(process, 'stdin', { configurable: true, enumerable: true, get: () => stdin });

port.on('message', (msg) => {
  if (msg && typeof msg.stdin === 'string') stdin.push(msg.stdin);
  else if (msg && msg.eof) stdin.push(null);
});
port.unref();

// Look like `node <entry> <args>`: argv[1] is the script and require.main is it.
process.argv = [process.argv[0], workerData.entry, ...process.argv.slice(2)];
/** @type {any} */ (Module).runMain();
