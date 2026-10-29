import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { buffersStore } from '../../state';
import { splitKey } from '../../state/buffers';
import { borderWidth, spacing } from '../../theme/tokens';
import { makeStyles, useColors } from '../../theme/theme';
import { addInput, clearConsole, DevtoolsState, emptyDevtools, parsePageMessage, reduce } from './devtools/devtools';
import { DevtoolsPanel } from './devtools/DevtoolsPanel';
import { DEVTOOLS_SCRIPT, evalScript } from './devtools/inject';
import { requirePro } from '../pro';
import { previewNavigation } from './navigation';

const LIVE_RELOAD_DELAY_MS = 400;

// Shows a port in the in-app browser: one on the device, or one in the
// container through the server's preview proxy. Dev tools show the page's
// console and requests, and saving a project file reloads the page.
export function PreviewScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { url, port, project } = useLocalSearchParams<{ url: string; port: string; project?: string }>();
  const webview = useRef<WebView<object>>(null);
  const [error, setError] = useState<string | null>(null);
  const [devtools, setDevtools] = useState<DevtoolsState>(emptyDevtools);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [liveReload, setLiveReload] = useState(true);
  const evalId = useRef(0);

  const reload = () => {
    setError(null);
    webview.current?.reload();
  };

  // A save is a buffer whose `saved` text changed.
  useEffect(() => {
    if (!project || !liveReload) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = buffersStore.subscribe((s, prev) => {
      const saved = Object.entries(s.buffers).some(([key, b]) => splitKey(key)[0] === project && prev.buffers[key] && prev.buffers[key].saved !== b.saved);
      if (!saved) return;
      clearTimeout(timer);
      timer = setTimeout(reload, LIVE_RELOAD_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project, liveReload]);

  function onMessage(e: WebViewMessageEvent) {
    const msg = parsePageMessage(e.nativeEvent.data);
    if (msg) setDevtools((s) => reduce(s, msg));
  }

  const path = devtools.url ? devtools.url.replace(/^https?:\/\/[^/]+/, '') || '/' : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="x" label="Close preview" onPress={() => router.back()} testID="preview-close" />
        <View style={styles.title}>
          <Text variant="title" numberOfLines={1}>
            Port {port}
          </Text>
          {path && path !== '/' && (
            <Text variant="muted" numberOfLines={1}>
              {path}
            </Text>
          )}
        </View>
        {project && (
          <IconButton
            icon={liveReload ? 'zap' : 'zap-off'}
            label={liveReload ? 'Live reload on: saving a file reloads the page' : 'Live reload off'}
            onPress={() => setLiveReload((on) => !on)}
            testID="preview-live-reload"
          />
        )}
        <IconButton icon="refresh-cw" label="Reload" onPress={reload} testID="preview-reload" />
        <View>
          <IconButton icon="tool" label={toolsOpen ? 'Hide dev tools' : 'Show dev tools'} onPress={() => (toolsOpen ? setToolsOpen(false) : requirePro('devtools') && setToolsOpen(true))} testID="preview-devtools" />
          {devtools.errors > 0 && !toolsOpen && <View style={[styles.badge, { backgroundColor: colors.destructive }]} pointerEvents="none" />}
        </View>
      </View>
      {error ? (
        <View style={styles.error}>
          <Text variant="error">{error}</Text>
        </View>
      ) : (
        <WebView<object>
          ref={webview}
          testID="preview-webview"
          source={{ uri: url }}
          // Pages of the project's server stay here; other sites open in Safari.
          onShouldStartLoadWithRequest={(req) => {
            const where = previewNavigation(req.url, url, req.isTopFrame ?? true);
            if (where === 'external') Linking.openURL(req.url).catch(() => undefined);
            return where === 'allow';
          }}
          style={styles.webview}
          onError={(e) => setError(e.nativeEvent.description)}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={DEVTOOLS_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          setSupportMultipleWindows={false}
        />
      )}
      {toolsOpen && (
        <View style={{ paddingBottom: insets.bottom, height: '40%' }}>
          <DevtoolsPanel
            state={devtools}
            onClear={() => setDevtools(clearConsole)}
            onEval={(code) => {
              setDevtools((s) => addInput(s, code));
              webview.current?.injectJavaScript(evalScript(++evalId.current, code));
            }}
          />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  title: { flex: 1, marginLeft: spacing.xs },
  webview: { flex: 1, backgroundColor: colors.background },
  error: { padding: spacing.md },
  badge: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4 },
}));
