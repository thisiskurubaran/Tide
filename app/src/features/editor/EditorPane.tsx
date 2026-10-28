import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { buffersStore, useBuffers, useSettings } from '../../state';
import { bufferKey } from '../../state/buffers';
import { editorThemes } from '../../theme/editor';
import { spacing } from '../../theme/tokens';
import { languageFor, parseFromEditor, ToEditor } from './bridge';
import type { Shortcut } from '../project/shortcuts';
import editorHtml from './editorHtml.generated';
import { makeStyles, useColorScheme } from '../../theme/theme';

export interface EditorHandle {
  send(msg: ToEditor): void;
  // Moves to a line once `path` is the open file; call it right after opening the tab.
  reveal(path: string, line: number): void;
}

interface EditorPaneProps {
  project: string;
  path: string | null;
  onBrowse(): void;
  onShortcut(id: Shortcut): void;
  onFocusChange(focused: boolean): void;
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane({ project, path, onBrowse, onFocusChange, onShortcut }, ref) {
  const styles = useStyles();
  const webview = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const pathRef = useRef(path);
  pathRef.current = path;
  // Last text the WebView is known to hold, so outside changes (e.g. the shell) can be pushed in.
  const editorContent = useRef<string | null>(null);
  const scheme = useColorScheme();
  const fontSize = useSettings((s) => s.editorFontSize);
  const bufferContent = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.content : undefined));

  const send = useCallback((msg: ToEditor) => {
    if (!ready.current) return;
    // Double-encoded so the payload is a JS string literal, not code.
    webview.current?.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`);
  }, []);

  const pendingReveal = useRef<{ path: string; line: number } | null>(null);
  const opened = useRef<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      send,
      reveal(target, line) {
        if (opened.current === target && pathRef.current === target) send({ type: 'goto', path: target, line });
        else pendingReveal.current = { path: target, line };
      },
    }),
    [send],
  );

  const sendTheme = useCallback(
    () => send({ type: 'setTheme', theme: editorThemes[scheme], dark: scheme === 'dark', fontSize }),
    [send, scheme, fontSize],
  );
  useEffect(sendTheme, [sendTheme]);

  const openCurrent = useCallback(async () => {
    const target = pathRef.current;
    if (!ready.current || !target) return;
    const buffer = await buffersStore.getState().load(project, target);
    // The user may have switched tabs while the file was loading.
    if (pathRef.current !== target) return;
    editorContent.current = buffer.content;
    send({ type: 'open', path: target, content: buffer.content, language: languageFor(target) });
    opened.current = target;
    const reveal = pendingReveal.current;
    if (reveal?.path === target) {
      pendingReveal.current = null;
      send({ type: 'goto', path: target, line: reveal.line });
    }
  }, [project, send]);

  useEffect(() => {
    openCurrent().catch((e) => console.warn('Could not open file', e));
  }, [path, openCurrent]);

  useEffect(() => {
    if (bufferContent !== undefined && editorContent.current !== null && bufferContent !== editorContent.current) {
      openCurrent().catch((e) => console.warn('Could not reload file', e));
    }
  }, [bufferContent, openCurrent]);

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
        openCurrent();
        return;
      case 'change':
        if (msg.path === pathRef.current) editorContent.current = msg.content;
        buffersStore.getState().edit(project, msg.path, msg.content);
        return;
      case 'save':
        buffersStore.getState().save(project, msg.path);
        return;
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
  empty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
}));
