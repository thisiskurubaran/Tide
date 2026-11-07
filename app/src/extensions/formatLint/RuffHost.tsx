import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { useStore } from 'zustand';

import { ruffBridge, ruffHostStore } from './ruffClient';
import type { FromRuff } from './ruffProtocol';

/* eslint-disable @typescript-eslint/no-require-imports */
const PAGE = require('../../../assets/ruff/ruff.html');
const WASM = require('../../../assets/ruff/ruff.wasm');
/* eslint-enable @typescript-eslint/no-require-imports */

const localUri = async (module: number) => {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  return asset.localUri ?? asset.uri;
};

// The hidden web view Ruff (Format & Lint for Python) runs in. Hermes and
// nodejs-mobile on iOS have no WebAssembly; WebKit's web views do. Mounted the
// first time a Python file is linted or formatted, at the app's root.
export function RuffHost() {
  const { wanted, generation } = useStore(ruffHostStore);
  const [uris, setUris] = useState<{ page: string; wasm: string } | null>(null);
  const [ref, setRef] = useState<WebView<object> | null>(null);

  useEffect(() => {
    if (!wanted || uris) return;
    Promise.all([localUri(PAGE), localUri(WASM)])
      .then(([page, wasm]) => setUris({ page, wasm }))
      .catch((e) => console.warn('Ruff assets', e));
  }, [wanted, uris]);

  useEffect(() => {
    ruffBridge.attach(ref ? (msg) => ref.injectJavaScript(`window.ruff && window.ruff.receive(${JSON.stringify(JSON.stringify(msg))});true;`) : null);
  }, [ref]);

  if (!wanted || !uris) return null;
  const dir = uris.page.slice(0, uris.page.lastIndexOf('/') + 1);
  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <WebView<object>
        key={generation}
        ref={setRef}
        source={{ uri: uris.page }}
        originWhitelist={['*']}
        // The page reads ruff.wasm next to it.
        allowingReadAccessToURL={dir}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onContentProcessDidTerminate={() => ruffBridge.crashed()}
        onRenderProcessGone={() => ruffBridge.crashed()}
        onMessage={(e) => {
          let msg: FromRuff;
          try {
            msg = JSON.parse(e.nativeEvent.data);
          } catch {
            return;
          }
          if (msg.type === 'ready') ruffBridge.loaded(uris.wasm);
          else ruffBridge.receive(msg);
        }}
      />
    </View>
  );
}
