// Entry point inside nodejs-mobile. Messages are JSON strings in both
// directions; the shapes are in shared/protocol.ts.
'use strict';

const path = require('path');
const rnBridge = require('rn-bridge');
const { createSupervisor } = require('./supervisor');

const supervisor = createSupervisor({
  send: (msg) => rnBridge.channel.send(JSON.stringify(msg)),
  builtins: { npm: path.join(__dirname, 'npm', 'cli.js'), pip: path.join(__dirname, 'pip', 'cli.js') },
});

rnBridge.channel.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  supervisor.handle(msg);
});

rnBridge.channel.send(JSON.stringify({ type: 'ready', node: process.version }));
