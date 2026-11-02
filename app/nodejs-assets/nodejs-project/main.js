// Entry point inside nodejs-mobile. Messages are JSON strings in both
// directions, wrapped in a numbered Envelope; the shapes are in shared/protocol.ts.
'use strict';

const path = require('path');
const rnBridge = require('rn-bridge');
const { inOrder } = require('./inorder');
const { createSupervisor } = require('./supervisor');

let sent = 0;
/** @param {object} msg */
const send = (msg) => rnBridge.channel.send(JSON.stringify({ n: sent++, m: msg }));

const supervisor = createSupervisor({
  send,
  builtins: {
    npm: path.join(__dirname, 'npm', 'cli.js'),
    pip: path.join(__dirname, 'pip', 'cli.js'),
    git: path.join(__dirname, 'git', 'cli.js'),
    ssh: path.join(__dirname, 'ssh', 'cli.js'),
    lua: path.join(__dirname, 'lua', 'cli.js'),
    sql: path.join(__dirname, 'sql', 'cli.js'),
    redis: path.join(__dirname, 'redis', 'cli.js'),
    mongo: path.join(__dirname, 'mongo', 'cli.js'),
    'google-jwt': path.join(__dirname, 'google', 'jwt.js'),
    format: path.join(__dirname, 'format', 'service.js'),
    intellisense: path.join(__dirname, 'intellisense', 'service.js'),
  },
});

const receive = inOrder((msg) => supervisor.handle(msg));

rnBridge.channel.on('message', (raw) => {
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return;
  }
  if (env && typeof env.n === 'number') receive(env.n, env.m);
});

send({ type: 'ready', node: process.version });
