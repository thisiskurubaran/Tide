import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { Button, IconButton } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { useEditorTheme } from '../../extensions/themes';
import { localRunner } from '../../runtime';
import { buffersStore, useSettings, workspace } from '../../state';
import { makeStyles, useColors, useColorScheme } from '../../theme/theme';
import { borderWidth, spacing } from '../../theme/tokens';
import { languageFor } from '../editor/bridge';
import { DiffLayout, parseFromDiff, ToDiff } from './bridge';
import diffHtml from './diffHtml.generated';
import { CompareRequest, Comparison, loadComparison } from './sources';
import { useModalAnimation } from '../../components/a11y';

const WIDE = 768;

// Full screen compare and merge. Comparisons against the saved file, the
// last commit or another file edit the open file as you go; merges are
// saved with a button.
export function CompareView({ project, request, onClose }: { project: string; request: CompareRequest | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation();
  const { width } = useWindowDimensions();
  const scheme = useColorScheme();
  const theme = useEditorTheme(scheme);
  const fontSize = useSettings((s) => s.editorFontSize);
  const webview = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<number | null>(null);
  const [layout, setLayout] = useState<DiffLayout>(width >= WIDE ? 'split' : 'unified');
  const result = useRef<string | null>(null);

  const send = useCallback((msg: ToDiff) => {
    if (ready.current) webview.current?.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`);
  }, []);

  useEffect(() => {
    setComparison(null);
    setError(null);
    setChunks(null);
    result.current = null;
    if (!request) return;
    loadComparison(project, request, {
      workspace,
      runner: localRunner,
      current: async () => (await buffersStore.getState().load(project, request.path)).content,
    }).then(setComparison, (e: Error) => setError(e.message));
  }, [project, request]);

  const show = useCallback(() => {
    if (!comparison || !request) return;
    send({
      type: 'show',
      original: comparison.original,
      modified: result.current ?? comparison.modified,
      language: languageFor(request.path),
      layout: width >= WIDE ? layout : 'unified',
      editable: true,
      controls: comparison.controls,
    });
  }, [comparison, request, layout, width, send]);
  useEffect(show, [show]);

  const sendTheme = useCallback(() => send({ type: 'setTheme', theme: theme.colors, dark: theme.dark, fontSize }), [send, theme, fontSize]);
  useEffect(sendTheme, [sendTheme]);

  function onMessage(e: WebViewMessageEvent) {
    const msg = parseFromDiff(e.nativeEvent.data);
    if (!msg || !request) return;
    if (msg.type === 'ready') {
      ready.current = true;
      sendTheme();
      show();
    } else if (msg.type === 'change') {
      result.current = msg.content;
      if (!comparison?.saveExplicitly) buffersStore.getState().edit(project, request.path, msg.content);
    } else if (msg.type === 'chunks') setChunks(msg.count);
    else if (msg.type === 'error') setError(msg.message);
  }

  async function saveMerge() {
    if (!request || !comparison) return;
    await buffersStore.getState().replace(project, request.path, result.current ?? comparison.modified);
    haptic('success');
    onClose();
  }

  function close() {
    if (comparison?.saveExplicitly && result.current !== null) {
      Alert.alert('Discard this merge?', 'The file keeps its conflict markers.', [
        { text: 'Keep merging', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ]);
    } else onClose();
  }

  return (
    <Modal visible={request !== null} animationType={animation} onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} onAccessibilityEscape={close}>
        <View style={styles.header}>
          <IconButton icon="x" label="Close" onPress={close} testID="compare-close" />
          <View style={styles.title}>
            <Text variant="label" numberOfLines={1}>
              {comparison?.title ?? request?.path ?? ''}
            </Text>
            {chunks !== null && <Text variant="muted">{chunks === 0 ? 'No differences' : `${chunks} ${chunks === 1 ? 'change' : 'changes'}`}</Text>}
          </View>
          <IconButton icon="chevron-up" label="Previous change" onPress={() => send({ type: 'prev' })} />
          <IconButton icon="chevron-down" label="Next change" onPress={() => send({ type: 'next' })} />
          {width >= WIDE && (
            <IconButton
              icon={layout === 'split' ? 'align-justify' : 'columns'}
              label={layout === 'split' ? 'Show inline' : 'Show side by side'}
              onPress={() => setLayout((l) => (l === 'split' ? 'unified' : 'split'))}
            />
          )}
          {comparison?.saveExplicitly && <Button title="Save" onPress={saveMerge} testID="compare-save" />}
        </View>
        <View style={styles.body}>
          <WebView<object>
            ref={webview}
            testID="compare"
            source={{ html: diffHtml }}
            originWhitelist={['about:blank']}
            onMessage={onMessage}
            onLoadStart={() => {
              ready.current = false;
            }}
            style={{ backgroundColor: theme.colors.background }}
            hideKeyboardAccessoryView
            keyboardDisplayRequiresUserAction={false}
            javaScriptEnabled
            allowFileAccess={false}
            setSupportMultipleWindows={false}
            textZoom={100}
          />
          {(error || !comparison) && (
            <View style={[StyleSheet.absoluteFill, styles.message, { backgroundColor: colors.background }]}>
              <Text variant={error ? 'error' : 'muted'}>{error ?? 'Loading...'}</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  title: { flex: 1, marginLeft: spacing.xs },
  body: { flex: 1 },
  message: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
}));
