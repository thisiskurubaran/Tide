// Phase 0 spike: echo messages back so the app can prove the RN <-> Node round trip.
// The full supervisor (worker_threads runner) replaces this in Phase 4.
const rnBridge = require('rn-bridge');

rnBridge.channel.on('message', (msg) => {
  rnBridge.channel.send(`node ${process.version} on ${process.platform}/${process.arch}: ${msg}`);
});

rnBridge.channel.send('ready');
