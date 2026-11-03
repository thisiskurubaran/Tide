import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import WebView from 'react-native-webview';

import { IconButton } from '../../components/Button';
import { buffersStore } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import { onlyStyles, RELOAD_KEEPING_SCROLL_SCRIPT, savedPaths, SWAP_CSS_SCRIPT } from '../remote/livePreview';
import { previewNavigation } from '../remote/navigation';
import { projectDirUrl, projectFileUrl } from './fileUrl';

const RELOAD_DELAY_MS = 300;

// An HTML file of the project shown as a page, straight from disk, so its
// stylesheets, scripts and images load. Saving reloads it (swapping only the
// stylesheets when just CSS changed); the expand button opens it full screen
// with dev tools, device widths and page checks.
// `compact` drops the floating tools, for the small live preview window.
export function HtmlFilePreview({ project, path, compact }: { project: string; path: string; compact?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const webview = useRef<WebView<object>>(null);
  const [ready, setReady] = useState(false);
  const url = useMemo(() => projectFileUrl(project, path), [project, path]);
  const root = useMemo(() => projectDirUrl(project), [project]);

  // The page reads the file on disk, so unsaved edits go there first.
  useEffect(() => {
    setReady(false);
    buffersStore
      .getState()
      .flushProject(project)
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [project, path]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string[] = [];
    const unsubscribe = buffersStore.subscribe((s, prev) => {
      const paths = savedPaths(prev.buffers, s.buffers, project);
      if (!paths.length) return;
      pending = [...pending, ...paths];
      clearTimeout(timer);
      timer = setTimeout(() => {
        webview.current?.injectJavaScript(onlyStyles(pending) ? SWAP_CSS_SCRIPT : RELOAD_KEEPING_SCROLL_SCRIPT);
        pending = [];
      }, RELOAD_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [project]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#ffffff' }]} testID="html-preview">
      {ready && (
        <WebView<object>
          ref={webview}
          source={{ uri: url }}
          originWhitelist={['*']}
          allowFileAccess
          allowFileAccessFromFileURLs
          allowingReadAccessToURL={root}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req) => {
            const where = previewNavigation(req.url, url, req.isTopFrame ?? true);
            if (where === 'external') Linking.openURL(req.url).catch(() => undefined);
            return where === 'allow';
          }}
          style={styles.web}
        />
      )}
      {!compact && (
      <View style={[styles.tools, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <IconButton icon="refresh-cw" label="Reload" onPress={() => webview.current?.reload()} testID="html-preview-reload" />
        <IconButton
          icon="maximize-2"
          label="Open full screen, with dev tools and device sizes"
          onPress={() => router.push({ pathname: '/preview', params: { url, project } })}
          testID="html-preview-full"
        />
      </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  web: { flex: 1, backgroundColor: '#ffffff' },
  tools: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, flexDirection: 'row', borderRadius: radius.lg, borderWidth: 1, opacity: 0.95 },
}));
