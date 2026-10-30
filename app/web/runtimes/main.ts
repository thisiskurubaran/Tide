// Runs Ruby (ruby.wasm, CRuby 3.4) and PHP (php-wasm, PHP 8.3) for Tide.
// The app loads this page from its own files in a hidden web view, sends the
// project's files with each run, and gets output and changed files back.
// WebAssembly can't run in the app's JavaScript engine or in nodejs-mobile on
// iOS, but WebKit's web views have it.
import { ConsoleStdout, Directory, File, Inode, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';
import { RubyVM } from '@ruby/wasm-wasi';
import { loadPHPRuntime, PHP } from '@php-wasm/universal';
// The asyncify build: WebKit has no JSPI.
import * as phpLoader from 'tide-php-loader';

import type { FileMap, FromRuntime, ToRuntime } from '../../src/runtime/wasm/protocol';

const post = (msg: FromRuntime) => window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
const encoder = new TextEncoder();

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// fetch() refuses file:// URLs in WebKit; XMLHttpRequest reads them.
function load(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => (xhr.status === 0 || xhr.status === 200 ? resolve(xhr.response) : reject(new Error(`${url}: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error(`Couldn't load ${url}`));
    xhr.send();
  });
}

let urls: { ruby: string; php: string } | null = null;
const modules: Partial<Record<'ruby' | 'php', Promise<WebAssembly.Module>>> = {};
const compiled = (runtime: 'ruby' | 'php', id: string) =>
  (modules[runtime] ??= (async () => {
    post({ type: 'status', id, text: `Starting ${runtime === 'ruby' ? 'Ruby' : 'PHP'}…` });
    return WebAssembly.compile(await load(urls![runtime]));
  })().catch((e) => {
    delete modules[runtime];
    throw e;
  }));

function lineWriter(id: string, type: 'stdout' | 'stderr') {
  return (text: string) => post({ type, id, data: text });
}

// ---- Ruby ------------------------------------------------------------------

function toTree(files: FileMap): Map<string, Inode> {
  const root = new Map<string, Inode>();
  for (const [path, b64] of Object.entries(files)) {
    const parts = path.split('/');
    let dir = root;
    for (const p of parts.slice(0, -1)) {
      let next = dir.get(p);
      if (!(next instanceof Directory)) {
        next = new Directory(new Map());
        dir.set(p, next);
      }
      dir = (next as Directory).contents;
    }
    dir.set(parts[parts.length - 1], new File(fromBase64(b64)));
  }
  return root;
}

function fromTree(dir: Map<string, Inode>, prefix = '', out: Record<string, Uint8Array> = {}) {
  for (const [name, node] of dir) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (node instanceof Directory) fromTree(node.contents, path, out);
    else if (node instanceof File) out[path] = node.data;
  }
  return out;
}

async function runRuby(id: string, entry: string, cwd: string, args: string[], files: FileMap, stdin: string) {
  const module = await compiled('ruby', id);
  const tree = toTree(files);
  const out = ConsoleStdout.lineBuffered((l) => lineWriter(id, 'stdout')(`${l}\n`));
  const err = ConsoleStdout.lineBuffered((l) => lineWriter(id, 'stderr')(`${l}\n`));
  const wasi = new WASI([], ['HOME=/project', 'TERM=xterm-256color'], [new OpenFile(new File(encoder.encode(stdin))), out, err, new PreopenDirectory('/project', tree)]);
  const { vm } = await RubyVM.instantiateModule({ module, wasip1: wasi, args: ['ruby.wasm', '-EUTF-8', '-e_=0'] });
  const q = (s: string) => JSON.stringify(s);
  // A script's exit status, uncaught exceptions printed like the ruby command does.
  const status = vm.eval(`
    Dir.chdir(${q(`/project/${cwd}`.replace(/\/$/, ''))})
    $0 = ${q(entry)}
    ARGV.replace(${JSON.stringify(args)})
    $LOAD_PATH.unshift(Dir.pwd)
    begin
      load ${q(`/project/${entry}`)}
      $stdout.flush
      0
    rescue SystemExit => e
      $stdout.flush
      e.status
    rescue Exception => e
      $stdout.flush
      $stderr.puts "#{e.backtrace&.first&.sub('/project/', '')}: #{e.message} (#{e.class})"
      # Up to the script's own frames; the rest is how Tide loaded it.
      (e.backtrace || [])[1..].take_while { |l| !l.start_with?('eval:') }.first(8).each { |l| $stderr.puts "\\tfrom #{l.sub('/project/', '')}" }
      $stderr.flush
      1
    end
  `);
  out.fd_close?.();
  err.fd_close?.();
  return { code: Number(status.toString()) || 0, after: fromTree(tree) };
}

// ---- PHP -------------------------------------------------------------------

async function newPHP(id: string) {
  const module = await compiled('php', id);
  const runtime = await loadPHPRuntime(phpLoader as never, {
    // Reuse the compiled module instead of compiling 18 MB on every run.
    // PHP's build links dynamically, so emscripten reads metadata from the module too.
    instantiateWasm(imports: WebAssembly.Imports, receive: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) {
      WebAssembly.instantiate(module, imports).then((instance) => receive(instance, module));
      return {};
    },
  } as never);
  return new PHP(runtime);
}

function walkPHP(php: PHP, dir: string, prefix = '', out: Record<string, Uint8Array> = {}) {
  for (const name of php.listFiles(dir)) {
    const path = prefix ? `${prefix}/${name}` : name;
    const full = `${dir}/${name}`;
    if (php.isDir(full)) walkPHP(php, full, path, out);
    else out[path] = php.readFileAsBuffer(full);
  }
  return out;
}

async function pump(stream: ReadableStream<Uint8Array>, write: (s: string) => void) {
  const reader = stream.getReader();
  const d = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    write(d.decode(value, { stream: true }));
  }
}

async function runPHP(id: string, entry: string, cwd: string, args: string[], files: FileMap, stdin: string) {
  const php = await newPHP(id);
  php.mkdir('/project');
  for (const [path, b64] of Object.entries(files)) {
    const dir = path.includes('/') ? `/project/${path.slice(0, path.lastIndexOf('/'))}` : '/project';
    php.mkdir(dir);
    php.writeFile(`/project/${path}`, fromBase64(b64));
  }
  if (stdin) php.writeFile('/tmp/.tide-stdin', encoder.encode(stdin));
  php.chdir(`/project/${cwd}`.replace(/\/$/, ''));
  const rel = cwd ? entry.slice(cwd.length + 1) : entry;
  const response = await php.cli(['php', rel, ...args]);
  await Promise.all([pump(response.stdout, lineWriter(id, 'stdout')), pump(response.stderr, lineWriter(id, 'stderr'))]);
  const code = await response.exitCode;
  return { code, after: walkPHP(php, '/project') };
}

// ---- Messages --------------------------------------------------------------

async function run(msg: Extract<ToRuntime, { type: 'run' }>) {
  try {
    const result = await (msg.runtime === 'ruby' ? runRuby : runPHP)(msg.id, msg.entry, msg.cwd, msg.args, msg.files, msg.stdin);
    const changed: FileMap = {};
    for (const [path, bytes] of Object.entries(result.after)) {
      if (!(path in msg.files) || !same(bytes, fromBase64(msg.files[path]))) changed[path] = toBase64(bytes);
    }
    const removed = Object.keys(msg.files).filter((p) => !(p in result.after));
    post({ type: 'exit', id: msg.id, code: result.code, changed, removed });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    post({ type: 'stderr', id: msg.id, data: `${text}\n` });
    post({ type: 'exit', id: msg.id, code: 1, changed: {}, removed: [] });
  }
}

window.tide = {
  receive(raw: string) {
    const msg = JSON.parse(raw) as ToRuntime;
    if (msg.type === 'init') urls = { ruby: msg.ruby, php: msg.php };
    else if (msg.type === 'run') run(msg);
  },
};
post({ type: 'ready' });
