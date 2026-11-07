// Runs Ruff (lint and format for Python) for Tide's Format & Lint. The app
// loads this page from its own files in a hidden web view and hands it the URL
// of ruff.wasm next to it; WebAssembly can't run in the app's JavaScript engine
// or in nodejs-mobile on iOS, but WebKit's web views have it.
import init, { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web';

import type { RuffSettings } from '../../src/extensions/formatLint/ruff';
import type { FromRuff, ToRuff } from '../../src/extensions/formatLint/ruffProtocol';

const post = (msg: FromRuff) => (window as unknown as { ReactNativeWebView?: { postMessage(m: string): void } }).ReactNativeWebView?.postMessage(JSON.stringify(msg));

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

let wasmUrl: string | null = null;
let started: Promise<unknown> | null = null;
const start = () =>
  (started ??= (async () => {
    if (!wasmUrl) throw new Error('Ruff has no module URL');
    return init({ module_or_path: await load(wasmUrl) });
  })().catch((e) => {
    started = null;
    throw e;
  }));

// One workspace per distinct settings; projects rarely have more than one.
const workspaces = new Map<string, Workspace>();
function workspace(settings: RuffSettings): Workspace {
  const key = JSON.stringify(settings);
  let w = workspaces.get(key);
  if (!w) {
    try {
      w = new Workspace(settings, PositionEncoding.Utf16);
    } catch (e) {
      // A setting this Ruff doesn't take: fall back to the rules alone.
      console.warn('Ruff settings', e);
      w = new Workspace({ lint: { select: settings.lint.select } }, PositionEncoding.Utf16);
    }
    if (workspaces.size > 8) workspaces.clear();
    workspaces.set(key, w);
  }
  return w;
}

const message = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error: /, '');

(window as unknown as { ruff: { receive(raw: string): void } }).ruff = {
  receive(raw) {
    const msg = JSON.parse(raw) as ToRuff;
    if (msg.type === 'init') {
      wasmUrl = msg.wasm;
      return;
    }
    start()
      .then(() => {
        const w = workspace(msg.settings);
        const result = msg.method === 'check' ? w.check(msg.content) : w.format(msg.content);
        post({ type: 'reply', id: msg.id, result });
      })
      .catch((e) => post({ type: 'reply', id: msg.id, error: message(e) }));
  },
};

post({ type: 'ready' });
