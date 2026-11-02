import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { breakpointsStore, fileBreakpoints, useBreakpoints } from '../../extensions/debugger/breakpoints';
import { useShallow } from 'zustand/react/shallow';

import { diagnosticsStore, EDITOR_SOURCE, fileDiagnostics, lineStarts, positionAt, useDiagnostics } from '../../extensions/diagnostics';
import { useEditorTheme } from '../../extensions/themes';
import { buffersStore, settingsStore, useBuffers, useSettings, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { spacing } from '../../theme/tokens';
import { CompletionResult, EditorFeatures, EditorRequest, HoverResult, languageFor, NO_FEATURES, parseFromEditor, ToEditor } from './bridge';
import { classify, formatBytes, TOO_LARGE_BYTES } from './largeFiles';
import type { Shortcut } from '../project/shortcuts';
import editorHtml from './editorHtml.generated';
import { makeStyles, useColorScheme } from '../../theme/theme';

export interface EditorHandle {
  send(msg: ToEditor): void;
  // Moves to a line once `path` is the open file; call it right after opening the tab.
  reveal(path: string, line: number, column?: number): void;
}

// What the editor asks of the app beyond editing: answered by extensions.
export interface EditorHost {
  request(req: EditorRequest): Promise<CompletionResult | HoverResult | null>;
  definition(path: string, offset: number): void;
  cursor(path: string, offset: number): void;
  save(path: string): void;
}

interface EditorPaneProps {
  project: string;
  path: string | null;
  features: EditorFeatures;
  host: EditorHost;
  onBrowse(): void;
  onShortcut(id: Shortcut): void;
  onFocusChange(focused: boolean): void;
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { project, path, features, host, onBrowse, onFocusChange, onShortcut },
  ref,
) {
  const styles = useStyles();
  const webview = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  // Last text the WebView is known to hold, so outside changes (e.g. the shell) can be pushed in.
  const editorContent = useRef<string | null>(null);
  const scheme = useColorScheme();
  const theme = useEditorTheme(scheme);
  const fontSize = useSettings((s) => s.editorFontSize);
  const wordWrap = useSettings((s) => s.wordWrap);
  const folding = useSettings((s) => s.folding);
  const indentGuides = useSettings((s) => s.indentGuides);
  const minimap = useSettings((s) => s.minimap);
  const keymap = useSettings((s) => s.keymap);
  const emmet = useSettings((s) => s.emmet);
  const snippets = useSettings((s) => s.snippets);
  const bufferContent = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.content : undefined));
  // fileDiagnostics builds a new array; compare its items so a re-render isn't a new value every time.
  const diagnostics = useDiagnostics(useShallow((s) => (path ? fileDiagnostics(s, project, path, EDITOR_SOURCE) : null)));
  const breakpoints = useBreakpoints((s) => (path ? fileBreakpoints(s, project, path) : null));
  const paused = useBreakpoints((s) => (s.paused?.project === project ? s.paused : null));
  const hostRef = useRef(host);
  hostRef.current = host;
  // Large files open as plain text with the heavy extras off; huge and
  // binary ones don't open, and say why instead.
  const [large, setLarge] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ path: string; message: string } | null>(null);
  const isLarge = large !== null && large === path;

  const send = useCallback((msg: ToEditor) => {
    if (!ready.current) return;
    // Double-encoded so the payload is a JS string literal, not code.
    webview.current?.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`);
  }, []);

  const pendingReveal = useRef<{ path: string; line: number; column?: number } | null>(null);
  const opened = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      send,
      reveal(target, line, column) {
        if (opened.current === target && pathRef.current === target) send({ type: 'goto', path: target, line, column });
        else pendingReveal.current = { path: target, line, column };
      },
    }),
    [send],
  );

  const sendTheme = useCallback(
    () => send({ type: 'setTheme', theme: theme.colors, dark: theme.dark, fontSize }),
    [send, theme, fontSize],
  );
  useEffect(sendTheme, [sendTheme]);

  const sendFeatures = useCallback(() => send({ type: 'features', features: isLarge ? NO_FEATURES : features }), [send, features, isLarge]);
  useEffect(sendFeatures, [sendFeatures]);

  const sendOptions = useCallback(
    () =>
      send({
        type: 'options',
        options: isLarge
          ? { wordWrap: false, folding: false, indentGuides: false, minimap: false, keymap }
          : { wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets },
      }),
    [send, wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets, isLarge],
  );
  useEffect(sendOptions, [sendOptions]);

  // Per-file state the editor shows. It caches it per path, so only changes are sent.
  const sendMarks = useCallback(() => {
    if (!path) return;
    send({
      type: 'diagnostics',
      path,
      items: (diagnostics ?? []).map(({ from, to, severity, message, source }) => ({ from, to, severity, message, source })),
    });
    send({ type: 'breakpoints', path, lines: breakpoints ?? [] });
  }, [send, path, diagnostics, breakpoints]);
  useEffect(sendMarks, [sendMarks]);

  const sendPaused = useCallback(
    () => send({ type: 'execLine', path: paused?.path ?? null, line: paused?.line ?? 0 }),
    [send, paused],
  );
  useEffect(sendPaused, [sendPaused]);

  const openCurrent = useCallback(async () => {
    const target = pathRef.current;
    if (!ready.current || !target) return;
    if (!buffersStore.getState().buffers[bufferKey(project, target)]) {
      const bytes = await workspace.fileSize(project, target);
      if (bytes > TOO_LARGE_BYTES) {
        if (pathRef.current === target) setRefused({ path: target, message: `This file is ${formatBytes(bytes)}, too big to edit here.` });
        return;
      }
    }
    const buffer = await buffersStore.getState().load(project, target);
    // The user may have switched tabs while the file was loading.
    if (pathRef.current !== target) return;
    const kind = classify(buffer.content);
    if (kind === 'binary') {
      setRefused({ path: target, message: "This looks like a binary file, so it can't be edited as text." });
      return;
    }
    setRefused(null);
    setLarge(kind === 'large' ? target : null);
    if (kind === 'large') {
      // Off before the text arrives, so the editor never highlights it.
      send({ type: 'options', options: { wordWrap: false, folding: false, indentGuides: false, minimap: false, keymap } });
      send({ type: 'features', features: NO_FEATURES });
    }
    editorContent.current = buffer.content;
    send({ type: 'open', path: target, content: buffer.content, language: kind === 'large' ? 'plain' : languageFor(target) });
    opened.current = target;
    const reveal = pendingReveal.current;
    if (reveal?.path === target) {
      pendingReveal.current = null;
      send({ type: 'goto', path: target, line: reveal.line, column: reveal.column });
    }
  }, [project, send]);

  useEffect(() => {
    openCurrent().catch((e) => console.warn('Could not open file', e));
  }, [path, openCurrent]);

  // Text changed outside the editor (format, git, the shell): applied as an
  // edit so the cursor and undo history survive.
  useEffect(() => {
    if (bufferContent === undefined || editorContent.current === null || bufferContent === editorContent.current) return;
    if (!path || opened.current !== path) {
      openCurrent().catch((e) => console.warn('Could not reload file', e));
      return;
    }
    send({ type: 'setContent', path, content: bufferContent, base: editorContent.current });
    editorContent.current = bufferContent;
  }, [bufferContent, openCurrent, path, send]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') buffersStore.getState().flushAll();
    });
    return () => {
      sub.remove();
      buffersStore.getState().flushProject(project);
    };
  }, [project]);

  function onMessage(event: WebViewMessageEvent) {
    const msg = parseFromEditor(event.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        ready.current = true;
        sendTheme();
        sendOptions();
        sendFeatures();
        openCurrent().then(() => {
          sendMarks();
          sendPaused();
        });
        return;
      case 'change':
        if (msg.path === pathRef.current) editorContent.current = msg.content;
        buffersStore.getState().edit(project, msg.path, msg.content);
        return;
      case 'save':
        hostRef.current.save(msg.path);
        return;
      case 'request':
        hostRef.current
          .request(msg)
          .catch(() => null)
          .then((result) => send({ type: 'response', id: msg.id, result }));
        return;
      case 'definition':
        hostRef.current.definition(msg.path, msg.offset);
        return;
      case 'cursor':
        hostRef.current.cursor(msg.path, msg.offset);
        return;
      case 'clipboard':
        Clipboard.setStringAsync(msg.text).catch(() => undefined);
        return;
      case 'zoom':
        settingsStore.getState().setEditorFontSize(msg.fontSize);
        return;
      case 'breakpointsChanged':
        breakpointsStore.getState().set(project, msg.path, msg.lines);
        return;
      case 'serviceDiagnostics': {
        // Lines and columns for the Problems panel, from the text they were found in.
        const text = buffersStore.getState().buffers[bufferKey(project, msg.path)]?.content ?? '';
        const starts = lineStarts(text);
        diagnosticsStore.getState().set(
          project,
          msg.path,
          EDITOR_SOURCE,
          msg.items.map((d) => ({ ...d, ...positionAt(starts, d.from) })),
        );
        return;
      }
      case 'focus':
        onFocusChange(msg.focused);
        return;
      case 'shortcut':
        onShortcut(msg.id);
        return;
      case 'error':
        console.warn('Editor error:', msg.message);
        return;
    }
  }

  return (
    <View style={styles.container}>
      {/* The default type argument makes WebView's props `WebViewProps & undefined`, i.e. never. */}
      <WebView<object>
        ref={webview}
        testID="editor"
        source={{ html: editorHtml }}
        originWhitelist={['about:blank']}
        onMessage={onMessage}
        // The web content reloads after a crash, so it has to ask for the file again.
        onContentProcessDidTerminate={() => {
          ready.current = false;
          opened.current = null;
          webview.current?.reload();
        }}
        onLoadStart={() => {
          ready.current = false;
          opened.current = null;
        }}
        style={styles.webview}
        containerStyle={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        javaScriptEnabled
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        textZoom={100}
      />
      {isLarge && (
        <View style={styles.banner} pointerEvents="none">
          <Text variant="muted" style={styles.bannerText}>
            Large file: highlighting, folding and the minimap are off
          </Text>
        </View>
      )}
      {path && refused?.path === path && (
        <View style={styles.empty} testID="editor-refused">
          <Text variant="muted" style={styles.refused}>
            {refused.message}
          </Text>
        </View>
      )}
      {!path && (
        <View style={styles.empty}>
          <Text variant="muted">No file open.</Text>
          <Button title="Browse files" variant="outline" icon="sidebar" onPress={onBrowse} />
        </View>
      )}
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  webview: { flex: 1, backgroundColor: colors.background },
  banner: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.secondary, opacity: 0.9 },
  bannerText: { fontSize: 11 },
  refused: { textAlign: 'center', paddingHorizontal: spacing.lg },
  empty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
}));
