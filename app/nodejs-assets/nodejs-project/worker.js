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

// Tell the app when the script starts or stops listening on a port, so the
// terminal can offer a preview of it. http.Server and others extend net.Server.
const net = require('net');
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (/** @type {any[]} */ ...args) {
  this.once('listening', () => {
    const address = this.address();
    if (!address || typeof address !== 'object') return;
    port.postMessage({ listening: address.port });
    this.once('close', () => port.postMessage({ closed: address.port }));
  });
  return listen.apply(this, /** @type {any} */ (args));
};

// Look like `node <entry> <args>`: argv[1] is the script and require.main is it.
process.argv = [process.argv[0], workerData.entry, ...process.argv.slice(2)];
const typescript = require('./typescript');
if (typescript.isTs(workerData.entry)) typescript.runTypeScript(workerData.entry);
else /** @type {any} */ (Module).runMain();
