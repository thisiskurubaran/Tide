import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { buffersStore } from '../../state';
import { borderWidth, spacing } from '../../theme/tokens';
import { makeStyles, useColors } from '../../theme/theme';
import { addInput, clearConsole, DevtoolsState, emptyDevtools, parsePageMessage, reduce } from './devtools/devtools';
import { DevtoolsPanel } from './devtools/DevtoolsPanel';
import { AUDIT_SCRIPT, auditScript } from './devtools/audit';
import { DEVTOOLS_SCRIPT, evalScript } from './devtools/inject';
import { layoutFor, onlyStyles, pageSetupScript, RELOAD_KEEPING_SCROLL_SCRIPT, savedPaths, setViewportScript, SWAP_CSS_SCRIPT, ViewportId, VIEWPORTS } from './livePreview';
import { previewNavigation } from './navigation';

const LIVE_RELOAD_DELAY_MS = 400;
const VIEWPORT_ICONS = { fit: 'maximize', phone: 'smartphone', tablet: 'tablet', desktop: 'monitor' } as const;

// Shows a port in the in-app browser: one on the device, or one in the
// container through the server's preview proxy. Dev tools show the page's
// console, requests and page checks; saving a project file reloads the page
// (or swaps its stylesheets, for CSS); the page can be shown at device widths.
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
  const isFile = url.startsWith('file:');
  const fileRoot = isFile ? (/^(file:\/\/.*?\/projects\/[^/]+\/)/.exec(url)?.[1] ?? url.slice(0, url.lastIndexOf('/') + 1)) : undefined;
  const auditId = useRef(0);
  const [viewport, setViewport] = useState<ViewportId>('fit');
  const [available, setAvailable] = useState(0);
  const preset = VIEWPORTS.find((v) => v.id === viewport)!;
  const layout = layoutFor(preset.width, available);
  // Fixed per mount: later width changes are applied with setViewportScript.
  const [setupScript] = useState(() => DEVTOOLS_SCRIPT + AUDIT_SCRIPT + pageSetupScript(null));
  const pageWidth = useRef<number | null>(null);

  useEffect(() => {
    if (pageWidth.current === layout.pageWidth) return;
    pageWidth.current = layout.pageWidth;
    webview.current?.injectJavaScript(setViewportScript(layout.pageWidth));
  }, [layout.pageWidth]);

  const reload = () => {
    setError(null);
    webview.current?.reload();
  };

  // A save is a buffer whose `saved` text changed.
  useEffect(() => {
    if (!project || !liveReload) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string[] = [];
    const unsubscribe = buffersStore.subscribe((s, prev) => {
      const paths = savedPaths(prev.buffers, s.buffers, project);
      if (paths.length === 0) return;
      pending = [...pending, ...paths];
      clearTimeout(timer);
      timer = setTimeout(() => {
        const css = onlyStyles(pending);
        pending = [];
        if (error) reload();
        else webview.current?.injectJavaScript(css ? SWAP_CSS_SCRIPT : RELOAD_KEEPING_SCROLL_SCRIPT);
      }, LIVE_RELOAD_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project, liveReload, error]);

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
            {port ? `Port ${port}` : isFile ? decodeURIComponent(url.split('/').pop() ?? url) : (/^\w+:\/\/([^/]+)/.exec(url)?.[1] ?? url)}
          </Text>
          {((path && path !== '/') || preset.width) && (
            <Text variant="muted" numberOfLines={1}>
              {[path && path !== '/' ? path : null, preset.width ? `${preset.label} · ${preset.width} pt` : null].filter(Boolean).join(' · ')}
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
        <IconButton
          icon={VIEWPORT_ICONS[viewport]}
          label={`Device width: ${preset.label}${preset.width ? `, ${preset.width} points` : ''}. Tap to change.`}
          onPress={() => setViewport(VIEWPORTS[(VIEWPORTS.indexOf(preset) + 1) % VIEWPORTS.length].id)}
          testID="preview-viewport"
        />
        <IconButton icon="refresh-cw" label="Reload" onPress={reload} testID="preview-reload" />
        <View>
          <IconButton icon="tool" label={toolsOpen ? 'Hide dev tools' : 'Show dev tools'} onPress={() => (toolsOpen ? setToolsOpen(false) : setToolsOpen(true))} testID="preview-devtools" />
          {devtools.errors > 0 && !toolsOpen && <View style={[styles.badge, { backgroundColor: colors.destructive }]} pointerEvents="none" />}
        </View>
      </View>
      {error ? (
        <View style={styles.error}>
          <Text variant="error">{error}</Text>
        </View>
      ) : (
        <View style={[styles.frameArea, { backgroundColor: layout.frame ? colors.secondary : colors.background }]} onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}>
        <WebView<object>
          ref={webview}
          testID="preview-webview"
          source={{ uri: url }}
          // A project's HTML file from disk may load the rest of its folder, nothing else.
          {...(isFile ? { originWhitelist: ['*'], allowFileAccess: true, allowFileAccessFromFileURLs: true, allowingReadAccessToURL: fileRoot } : {})}
          // Pages of the project's server stay here; other sites open in Safari.
          onShouldStartLoadWithRequest={(req) => {
            const where = previewNavigation(req.url, url, req.isTopFrame ?? true);
            if (where === 'external') Linking.openURL(req.url).catch(() => undefined);
            return where === 'allow';
          }}
          containerStyle={layout.frame ? { flex: 0, width: layout.frame, alignSelf: 'center', height: '100%' } : undefined}
          style={styles.webview}
          onError={(e) => setError(e.nativeEvent.description)}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={setupScript}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          setSupportMultipleWindows={false}
          onLoadEnd={() => layout.pageWidth && webview.current?.injectJavaScript(setViewportScript(layout.pageWidth))}
        />
        </View>
      )}
      {toolsOpen && (
        <View style={{ paddingBottom: insets.bottom, height: '40%' }}>
          <DevtoolsPanel
            state={devtools}
            onClear={() => setDevtools(clearConsole)}
            onAudit={() => webview.current?.injectJavaScript(auditScript(++auditId.current))}
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
  frameArea: { flex: 1 },
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
