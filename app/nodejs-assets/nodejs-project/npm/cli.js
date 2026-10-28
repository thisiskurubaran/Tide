// @ts-check
// `npm` in the local shell. Runs in a worker like any script; cwd is the
// directory the user typed the command in.
'use strict';

const { install } = require('./install');

const USAGE = 'usage: npm install [package...]\nOther npm commands need Remote mode.';

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'install' || command === 'i' || command === 'add') {
    const specs = rest.filter((a) => !a.startsWith('-'));
    await install({ cwd: process.cwd(), add: specs, registry: process.env.TIDE_NPM_REGISTRY });
    return 0;
  }
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  console.error(`npm ${command}: not available locally.\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`npm error: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  },
);
