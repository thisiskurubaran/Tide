import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { createStore, useStore } from 'zustand';

import { workspace } from '../../state';
import type { FileMap, FromRuntime, ToRuntime } from './protocol';
import { WasmFiles, WasmRunner } from './runner';

/* eslint-disable @typescript-eslint/no-require-imports */
const PAGE = require('../../../assets/runtimes/runtime.html');
const RUBY = require('../../../assets/runtimes/ruby.wasm');
const PHP = require('../../../assets/runtimes/php.wasm');
/* eslint-enable @typescript-eslint/no-require-imports */

// Projects this big would take too long to copy into the interpreter on every run.
const MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const SKIP = /(^|\/)(\.git|node_modules|\.pylibs|__pycache__)(\/|$)/;

const files: WasmFiles = {
  async read(project) {
    const out: FileMap = {};
    let bytes = 0;
    for (const path of await workspace.listFiles(project)) {
      if (SKIP.test(path)) continue;
      const b64 = await workspace.readBase64(project, path);
      bytes += (b64.length * 3) / 4;
      if (bytes > MAX_PROJECT_BYTES) throw new Error('The project is over 25 MB; Ruby and PHP runs copy the whole project, so move large files out of it.');
      out[path] = b64;
    }
    return out;
  },
  async apply(project, changed, removed) {
    for (const [path, b64] of Object.entries(changed)) await workspace.writeBase64(project, path, b64);
    for (const path of removed) await workspace.removeIfPresent(project, path);
  },
};

const localUri = async (module: number) => {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
};

// Whether the page is mounted, and a key to remount it (stopping a run).
const hostStore = createStore<{ wanted: boolean; generation: number; source: string | null }>(() => ({ wanted: false, generation: 0, source: null }));
let post: ((msg: ToRuntime) => void) | null = null;
let readyWaiters: (() => void)[] = [];
let isReady = false;

export const wasmRunner = new WasmRunner(
  {
    async ready() {
      if (isReady) return;
      if (!hostStore.getState().source) hostStore.setState({ source: await localUri(PAGE) });
      hostStore.setState({ wanted: true });
      await new Promise<void>((resolve) => readyWaiters.push(resolve));
    },
    send: (msg) => post?.(msg),
    restart() {
      isReady = false;
      hostStore.setState((s) => ({ generation: s.generation + 1 }));
    },
  },
  files,
  async () => ({ ruby: await localUri(RUBY), php: await localUri(PHP) }),
);

// The hidden web view Ruby and PHP run in, mounted the first time one runs.
// Lives at the app's root so runs survive moving between screens.
export function WasmHost() {
  const { wanted, generation, source } = useStore(hostStore);
  const [ref, setRef] = useState<WebView<object> | null>(null);
  useEffect(() => {
    post = ref ? (msg) => ref.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`) : null;
  }, [ref]);
  if (!wanted || !source) return null;
  const dir = source.slice(0, source.lastIndexOf('/') + 1);
  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <WebView<object>
        key={generation}
        ref={setRef}
        source={{ uri: source }}
        originWhitelist={['*']}
        // The page reads ruby.wasm and php.wasm next to it.
        allowingReadAccessToURL={dir}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={(e) => {
          let msg: FromRuntime;
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'ready') {
            isReady = true;
            readyWaiters.forEach((w) => w());
            readyWaiters = [];
          }
          wasmRunner.receive(msg);
        }}
      />
    </View>
  );
}
