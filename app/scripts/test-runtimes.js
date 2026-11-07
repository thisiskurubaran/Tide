// Checks the Ruby and PHP runtime page in Chromium, loading it from file://
// the way the app's web view does: scripts that use arguments, libraries,
// files and exit codes, and the files they change coming back.
//
//   npm run test:runtimes   (needs Playwright with Chromium installed)
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '..', 'assets', 'runtimes');
const b64 = (s) => Buffer.from(s).toString('base64');
const text = (s) => Buffer.from(s, 'base64').toString();

(async () => {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__msgs = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__msgs.push(JSON.parse(m)) };
  });
  await page.goto(`file://${dir}/runtime.html`);
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'));
  const send = (m) => page.evaluate((m) => window.tide.receive(JSON.stringify(m)), m);
  await send({ type: 'init', ruby: `file://${dir}/ruby.wasm`, php: `file://${dir}/php.wasm` });

  const run = async (runtime, entry, files, args = [], env = {}) => {
    const id = `${runtime}-${entry}`;
    await send({ type: 'run', id, runtime, entry, cwd: '', args, env, files, stdin: '' });
    await page.waitForFunction((id) => window.__msgs.some((m) => m.type === 'exit' && m.id === id), id, { timeout: 120000 });
    const msgs = await page.evaluate((id) => window.__msgs.filter((m) => m.id === id), id);
    const join = (type) => msgs.filter((m) => m.type === type).map((m) => m.data).join('');
    return { out: join('stdout'), err: join('stderr'), exit: msgs.find((m) => m.type === 'exit') };
  };

  let r = await run('ruby', 'main.rb', {
    'main.rb': b64('require "json"\nrequire_relative "lib/greet"\nputs greet(ARGV.first)\nputs JSON.generate({ ok: true })\nFile.write("out.txt", "ruby\\n")\nFile.delete("old.txt")\n'),
    'lib/greet.rb': b64('def greet(n) = "Hello, #{n}!"\n'),
    'old.txt': b64('x'),
  }, ['Ada']);
  assert.strictEqual(r.out, 'Hello, Ada!\n{"ok":true}\n');
  assert.strictEqual(text(r.exit.changed['out.txt']), 'ruby\n');
  assert.deepStrictEqual(r.exit.removed, ['old.txt']);

  r = await run('ruby', 'boom.rb', { 'boom.rb': b64('raise ArgumentError, "bad"\n') });
  assert.strictEqual(r.exit.code, 1);
  assert.match(r.err, /boom\.rb:1:in .*bad \(ArgumentError\)/);

  r = await run('php', 'index.php', { 'index.php': b64('<?php\nrequire "lib.php";\necho greet($argv[1]), PHP_EOL;\nfile_put_contents("out.txt", "php\\n");\nexit(3);\n'), 'lib.php': b64('<?php function greet($n) { return "Hello, $n!"; }\n') }, ['Grace']);
  assert.strictEqual(r.out, 'Hello, Grace!\n');
  assert.strictEqual(r.exit.code, 3);
  assert.strictEqual(text(r.exit.changed['out.txt']), 'php\n');

  r = await run('ruby', 'env.rb', { 'env.rb': b64('puts ENV.fetch("API_KEY")\n') }, [], { API_KEY: 'k-123' });
  assert.strictEqual(r.out, 'k-123\n');
  r = await run('php', 'env.php', { 'env.php': b64('<?php echo getenv("API_KEY"), "|", $_ENV["API_KEY"] ?? $_SERVER["API_KEY"] ?? "", PHP_EOL;\n') }, [], { API_KEY: 'k-456' });
  assert.strictEqual(r.out.split('|')[0], 'k-456');

  await browser.close();
  console.log('Ruby and PHP runtimes: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
