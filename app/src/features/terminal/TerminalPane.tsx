import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Linking, StyleSheet } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { localRunner } from '../../runtime';
import { buffersStore, projectsStore, workspace } from '../../state';
import { PROJECTS_DIR } from '../files/workspace';
import { terminalThemes } from '../../theme/terminal';
import { colors } from '../../theme/tokens';
import { parseFromTerminal, ToTerminal } from './bridge';
import { Shell } from './shell/shell';
import { createShellFs } from './shell/shellFs';
import terminalHtml from './terminalHtml.generated';

export interface TerminalHandle {
  input(data: string): void;
  blur(): void;
}

interface TerminalPaneProps {
  project: string;
  onFocusChange(focused: boolean): void;
}

// Output from fast programs arrives in many small chunks; batching them keeps
// the number of injectJavaScript calls to roughly one per frame.
const FLUSH_MS = 16;

export const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane({ project, onFocusChange }, ref) {
  const webview = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const pending = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<Shell | null>(null);

  const send = useCallback((msg: ToTerminal) => {
    if (!ready.current) return;
    webview.current?.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`);
  }, []);

  const flush = useCallback(() => {
    timer.current = null;
    if (!ready.current || !pending.current) return;
    const data = pending.current;
    pending.current = '';
    send({ type: 'write', data });
  }, [send]);

  const write = useCallback(
    (data: string) => {
      pending.current += data;
      if (timer.current === null) timer.current = setTimeout(flush, FLUSH_MS);
    },
    [flush],
  );

  // One shell per project screen; it outlives WebView reloads.
  if (shell.current === null) {
    shell.current = new Shell({
      project,
      fs: createShellFs(project, workspace, projectsStore, buffersStore),
      runner: localRunner,
      write,
      projectRoot: `${PROJECTS_DIR}/${project}`,
    });
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      shell.current?.dispose();
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      input: (data) => shell.current?.input(data),
      blur: () => send({ type: 'blur' }),
    }),
    [send],
  );

  const started = useRef(false);

  function onMessage(event: WebViewMessageEvent) {
    const msg = parseFromTerminal(event.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        ready.current = true;
        send({ type: 'setTheme', theme: terminalThemes.dark });
        shell.current?.resize(msg.cols);
        if (!started.current) {
          started.current = true;
          shell.current?.start();
        }
        flush();
        return;
      case 'input':
        shell.current?.input(msg.data);
        return;
      case 'resize':
        shell.current?.resize(msg.cols);
        return;
      case 'focus':
        onFocusChange(msg.focused);
        return;
      case 'link':
        Linking.openURL(msg.url).catch(() => undefined);
        return;
    }
  }

  return (
    <WebView<object>
      ref={webview}
      source={{ html: terminalHtml }}
      originWhitelist={['about:blank']}
      onMessage={onMessage}
      onContentProcessDidTerminate={() => {
        ready.current = false;
        webview.current?.reload();
      }}
      onLoadStart={() => {
        ready.current = false;
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
  );
});

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: colors.background },
});
