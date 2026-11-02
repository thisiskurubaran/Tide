import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { Linking } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';

import { localRunner } from '../../runtime';
import { buffersStore, projectsStore, settingsStore, useSettings, workspace } from '../../state';
import { PROJECTS_DIR } from '../files/workspace';
import { useTerminalTheme } from '../../extensions/themes';

import type { TerminalBackend } from './backend';
import { openProjectDb } from '../database/open';
import { projectEnv, readSecrets } from '../env/store';
import { autoDeployer } from '../deploy';
import { parseFromTerminal, ToTerminal } from './bridge';
import { gitEnv } from '../git/settings';
import type { Shortcut } from '../project/shortcuts';
import { Shell } from './shell/shell';
import { createShellFs } from './shell/shellFs';
import terminalHtml from './terminalHtml.generated';
import { makeStyles, useColorScheme } from '../../theme/theme';

export interface TerminalHandle {
  input(data: string): void;
  blur(): void;
  find(query: string, backwards?: boolean, caseSensitive?: boolean): void;
  clearFind(): void;
}

interface TerminalPaneProps {
  project: string;
  onFocusChange(focused: boolean): void;
  onShortcut(id: Shortcut): void;
  // Remote mode passes its PTY; read once, when the pane mounts.
  createBackend?: (write: (data: string) => void) => TerminalBackend;
  // Results of find(): the active match (-1 when unknown) and how many there are.
  onFound?(index: number, count: number): void;
}

// Output from fast programs arrives in many small chunks; batching them keeps
// the number of injectJavaScript calls to roughly one per frame.
const FLUSH_MS = 16;

export const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane({ project, onFocusChange, onShortcut, createBackend, onFound }, ref) {
  const styles = useStyles();
  const webview = useRef<WebView<object>>(null);
  const ready = useRef(false);
  const pending = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shell = useRef<TerminalBackend | null>(null);
  const scheme = useColorScheme();
  const theme = useTerminalTheme(scheme);
  const fontSize = useSettings((s) => s.terminalFontSize);

  const send = useCallback((msg: ToTerminal) => {
    if (!ready.current) return;
    webview.current?.injectJavaScript(`window.tide && window.tide.receive(${JSON.stringify(JSON.stringify(msg))});true;`);
  }, []);

  const sendTheme = useCallback(() => send({ type: 'setTheme', theme, fontSize }), [send, theme, fontSize]);
  useEffect(sendTheme, [sendTheme]);

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

  // One backend per pane; it outlives WebView reloads.
  if (shell.current === null) {
    shell.current = createBackend?.(write) ?? new Shell({
      project,
      fs: createShellFs(project, workspace, projectsStore, buffersStore),
      runner: localRunner,
      write,
      projectRoot: `${PROJECTS_DIR}/${project}`,
      toolEnv: gitEnv,
      sqlite: { open: (path) => openProjectDb(project, path) },
      projectEnv: async () => {
        const [values, secrets] = await Promise.all([projectEnv(project), readSecrets(project)]);
        return { values, secrets: Object.keys(secrets) };
      },
      onRunExit: (entry, args, code) => {
        if (entry === 'tide:git' && args[0] === 'commit' && code === 0) autoDeployer.onCommit(project).catch(() => undefined);
      },
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
      find: (query, backwards = false, caseSensitive = false) => send({ type: 'find', query, backwards, caseSensitive }),
      clearFind: () => send({ type: 'clearFind' }),
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
        sendTheme();
        shell.current?.resize(msg.cols, msg.rows);
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
        shell.current?.resize(msg.cols, msg.rows);
        return;
      case 'focus':
        onFocusChange(msg.focused);
        return;
      case 'link':
        Linking.openURL(msg.url).catch(() => undefined);
        return;
      case 'shortcut':
        onShortcut(msg.id);
        return;
      case 'zoom':
        settingsStore.getState().setTerminalFontSize(msg.fontSize);
        return;
      case 'found':
        onFound?.(msg.index, msg.count);
        return;
    }
  }

  return (
    <WebView<object>
      ref={webview}
      testID="terminal"
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

const useStyles = makeStyles((colors) => ({
  webview: { flex: 1, backgroundColor: colors.background },
}));
