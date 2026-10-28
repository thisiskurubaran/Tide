// @ts-check
// `pip` in the local shell. Installs into <project>/.pylibs, which the Python
// runner puts on sys.path. The supervisor sets TIDE_PROJECT_DIR.
'use strict';

const fs = require('fs');
const path = require('path');

const { install, list, uninstall } = require('./install');

const USAGE = [
  'usage: pip install <package>... | -r requirements.txt',
  '       pip uninstall <package>...',
  '       pip list',
  'Only pure-Python packages install locally; others need Remote mode.',
].join('\n');

async function main(args) {
  const projectDir = process.env.TIDE_PROJECT_DIR || process.cwd();
  const [command, ...rest] = args;
  const index = process.env.TIDE_PIP_INDEX;
  if (command === 'install') {
    const requirements = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-r' || rest[i] === '--requirement') {
        const file = path.resolve(process.cwd(), rest[++i] || '');
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
          const req = line.replace(/#.*/, '').trim();
          if (req && !req.startsWith('-')) requirements.push(req);
        }
      } else if (!rest[i].startsWith('-')) {
        requirements.push(rest[i]);
      }
    }
    if (!requirements.length) {
      console.error(USAGE);
      return 1;
    }
    await install({ projectDir, requirements, index });
    return 0;
  }
  if (command === 'uninstall') {
    uninstall({ projectDir, names: rest.filter((a) => !a.startsWith('-')) });
    return 0;
  }
  if (command === 'list' || command === 'freeze') {
    for (const p of list({ projectDir })) console.log(command === 'freeze' ? `${p.name}==${p.version}` : `${p.name.padEnd(24)} ${p.version}`);
    return 0;
  }
  console.log(USAGE);
  return command ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`pip error: ${err && err.message ? err.message : err}`);
    process.exitCode = 1;
  },
);
