import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import WebView, { WebViewMessageEvent } from 'react-native-webview';
import * as Clipboard from 'expo-clipboard';

import { announce, useScreenReader } from '../../components/a11y';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { breakpointsStore, fileBreakpoints, useBreakpoints } from '../../extensions/debugger/breakpoints';
import { useShallow } from 'zustand/react/shallow';

import { diagnosticsStore, EDITOR_SOURCE, fileDiagnostics, lineStarts, positionAt, useDiagnostics } from '../../extensions/diagnostics';
import { useEditorTheme } from '../../extensions/themes';
import { buffersStore, projectsStore, settingsStore, useBuffers, useSettings, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { registerEditorFlush } from '../../state/editorFlush';
import { basename } from '../files/fs';
import { spacing } from '../../theme/tokens';
import { ALL_GESTURES, CompletionResult, DEFAULT_CODE_FONT, EditorFeatures, EditorRequest, HoverResult, isCodeFont, languageFor, NO_FEATURES, NO_GESTURES, parseFromEditor, ToEditor } from './bridge';
import type { PeekTarget } from './bridge';
import { classify, formatBytes, TOO_LARGE_BYTES } from './largeFiles';
import { useInlineCompletions } from './useInlineCompletions';
import { useAiFix } from './useAiFix';
import { createSaveFormatter, fileFormatting, ReadFile } from './saveFormatting';
import { selectionStore } from './selection';
import type { Shortcut } from '../project/shortcuts';
import editorHtml from './editorHtml.generated';
import { makeStyles, useColorScheme } from '../../theme/theme';

const PROBLEM_ACTIONS = [
  { name: 'nextProblem', label: 'Next problem' },
  { name: 'previousProblem', label: 'Previous problem' },
];

// Narrower windows (phones, Slide Over) don't show the minimap.
export const MINIMAP_MIN_WIDTH = 600;

// flush() doesn't wait longer than this for an editor that doesn't answer
// (still loading, or its web content crashed).
export const FLUSH_TIMEOUT_MS = 500;

const readProjectFile: ReadFile = (project, path) =>
  Promise.resolve()
    .then(() => workspace.readFile(project, path))
    .catch(() => null);

// Trim trailing whitespace and insert final newline on save (see
// saveFormatting.ts), from Settings and each file's .editorconfig. Set once,
// by the first editor; it applies to every save from then on.
let saveFormatterSet = false;
function setSaveFormatter() {
  if (saveFormatterSet) return;
  saveFormatterSet = true;
  buffersStore.getState().setSaveFormatter?.(createSaveFormatter(readProjectFile, () => settingsStore.getState()));
}

export interface EditorHandle {
  send(msg: ToEditor): void;
  // Moves to a line once `path` is the open file; call it right after opening the tab.
  reveal(path: string, line: number, column?: number): void;
  // Resolves once typing the editor was still holding back (its change
  // messages are debounced) has reached the buffer, e.g. before closing a tab.
  flush(): Promise<void>;
}

// What the editor asks of the app beyond editing: answered by extensions.
export interface EditorHost {
  request(req: EditorRequest): Promise<CompletionResult | HoverResult | null>;
  definition(path: string, offset: number): void;
  cursor(path: string, offset: number): void;
  save(path: string): void;
  // Peek definition at `offset`: a few lines around the definition, or null.
  peek?(path: string, offset: number): Promise<PeekTarget | null>;
  // "Open" in a peek: show `path` at a 1-based line, opening its tab if needed.
  openAt?(path: string, line: number): void;
}

interface EditorPaneProps {
  project: string;
  path: string | null;
  features: EditorFeatures;
  host: EditorHost;
  onBrowse(): void;
  onShortcut(id: Shortcut): void;
  onFocusChange(focused: boolean): void;
  // A two-finger tap in the editor.
  onActions?(): void;
  // AI ghost text appeared or went away, e.g. to show Accept in the key bar.
  onCompletionState?(visible: boolean): void;
  // "✦ Fix" tapped in the error lens of a 1-based line. Without it the button isn't shown.
  onFixProblem?(path: string, line: number): void;
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  { project, path, features, host, onBrowse, onFocusChange, onShortcut, onActions, onCompletionState, onFixProblem },
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
  // A minimap is noise at phone width; it shows on iPad-sized windows.
  const wideEnough = useWindowDimensions().width >= MINIMAP_MIN_WIDTH;
  const minimap = useSettings((s) => s.minimap) && wideEnough;
  const keymap = useSettings((s) => s.keymap);
  const emmet = useSettings((s) => s.emmet);
  const snippets = useSettings((s) => s.snippets);
  const codeFont = useSettings((s) => s.codeFont);
  const ligatures = useSettings((s) => s.ligatures);
  // Missing in settings saved before the option existed: on.
  const errorLens = useSettings((s) => s.errorLens) !== false;
  const gestureSettings = useSettings((s) => s.gestures);
  // Gestures would fight VoiceOver / TalkBack's own, so they are all off while one runs.
  const screenReader = useScreenReader();
  const bufferContent = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.content : undefined));
  // Deleted on disk while it had unsaved edits (see buffers.ts).
  const deleted = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.deleted === true : false));
  // Where unsaved edits went when another file took this one's path (see buffers.ts).
  const recoveredTo = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.recoveredTo : undefined));
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

  // AI inline completions, off for large and refused files.
  const inline = useInlineCompletions(send, !!path && !isLarge && refused?.path !== path);
  const onCompletionStateRef = useRef(onCompletionState);
  onCompletionStateRef.current = onCompletionState;
  const onFixProblemRef = useRef(onFixProblem);
  onFixProblemRef.current = onFixProblem;
  const aiFix = useAiFix(send, !!onFixProblem && !!path && !isLarge && refused?.path !== path);

  const pendingReveal = useRef<{ path: string; line: number; column?: number } | null>(null);
  const opened = useRef<string | null>(null);
  const flushes = useRef(new Map<number, () => void>());
  const nextFlush = useRef(0);
  // Files the WebView just stopped showing: their last typing (sent when the
  // next file opens or the document closes) is still taken until the editor
  // confirms it has sent everything. Any other file's changes are ignored.
  const retiring = useRef(new Map<string, number>());
  // Unblocks waiting flush() calls, e.g. when the web content reloads.
  const settleFlushes = () => {
    for (const done of [...flushes.current.values()]) done();
  };

  // Resolves once the editor has sent everything it held back before this call.
  const flush = useCallback(() => {
    if (!ready.current) return Promise.resolve();
    const id = ++nextFlush.current;
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        flushes.current.delete(id);
        resolve();
      };
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS);
      flushes.current.set(id, done);
      send({ type: 'flush', id });
    });
  }, [send]);

  // The state flushes every editor before treating a file as deleted.
  useEffect(() => registerEditorFlush(flush), [flush]);
  useEffect(setSaveFormatter, []);

  const retire = (prev: string | null) => {
    if (prev === null) return;
    retiring.current.set(prev, (retiring.current.get(prev) ?? 0) + 1);
    flush().then(() => {
      const n = (retiring.current.get(prev) ?? 1) - 1;
      if (n > 0) retiring.current.set(prev, n);
      else retiring.current.delete(prev);
    });
  };

  // No file to edit here (none selected, a viewer, refused, failed to open):
  // the WebView drops the open document and focus, so typing, the key bar
  // or a hardware keyboard can't keep editing the file shown before.
  const closeDocument = () => {
    const prev = opened.current;
    opened.current = null;
    editorContent.current = null;
    if (!ready.current) return;
    send({ type: 'close' });
    retire(prev);
  };

  useImperativeHandle(
    ref,
    () => ({
      send,
      reveal(target, line, column) {
        if (opened.current === target && pathRef.current === target) send({ type: 'goto', path: target, line, column });
        else pendingReveal.current = { path: target, line, column };
      },
      flush,
    }),
    [send, flush],
  );

  const sendTheme = useCallback(
    () => send({ type: 'setTheme', theme: theme.colors, dark: theme.dark, fontSize }),
    [send, theme, fontSize],
  );
  useEffect(sendTheme, [sendTheme]);

  // A font id saved by a build that had more fonts falls back to the default.
  const sendFont = useCallback(
    () => send({ type: 'setFont', font: isCodeFont(codeFont) ? codeFont : DEFAULT_CODE_FONT, ligatures: ligatures === true }),
    [send, codeFont, ligatures],
  );
  useEffect(sendFont, [sendFont]);

  const sendGestures = useCallback(
    () => send({ type: 'setGestures', gestures: screenReader ? NO_GESTURES : { ...ALL_GESTURES, ...gestureSettings } }),
    [send, screenReader, gestureSettings],
  );
  useEffect(sendGestures, [sendGestures]);

  const sendFeatures = useCallback(() => send({ type: 'features', features: isLarge ? NO_FEATURES : features }), [send, features, isLarge]);
  useEffect(sendFeatures, [sendFeatures]);

  const sendOptions = useCallback(
    () =>
      send({
        type: 'options',
        options: {
          ...(isLarge
            ? { wordWrap: false, folding: false, indentGuides: false, minimap: false, keymap }
            : { wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets, errorLens }),
          // Only when on, so the editor's options stay as they were for everyone else.
          ...(screenReader ? { screenReader } : {}),
        },
      }),
    [send, wordWrap, folding, indentGuides, minimap, keymap, emmet, snippets, errorLens, screenReader, isLarge],
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
    if (!ready.current) return;
    if (!target) {
      closeDocument();
      return;
    }
    const refuse = (message: string) => {
      // The user may have switched tabs meanwhile.
      if (pathRef.current !== target) return;
      setRefused({ path: target, message });
      closeDocument();
    };
    // The file's .editorconfig, read while the file loads; fresh on every
    // open, so an edited .editorconfig applies when a file opens again.
    const formatting = fileFormatting(readProjectFile, project, target, true);
    let buffer;
    try {
      if (!buffersStore.getState().buffers[bufferKey(project, target)]) {
        const bytes = await workspace.fileSize(project, target);
        if (bytes > TOO_LARGE_BYTES) return refuse(`This file is ${formatBytes(bytes)}, too big to edit here.`);
      }
      buffer = await buffersStore.getState().load(project, target);
    } catch (e) {
      console.warn('Could not open file', e);
      return refuse(`Couldn't open ${basename(target)}. It may have been deleted or moved.`);
    }
    // The user may have switched tabs while the file was loading.
    if (pathRef.current !== target) return;
    const kind = classify(buffer.content);
    if (kind === 'binary') return refuse("This looks like a binary file, so it can't be edited as text.");
    setRefused(null);
    setLarge(kind === 'large' ? target : null);
    if (kind === 'large') {
      // Off before the text arrives, so the editor never highlights it.
      send({ type: 'options', options: { wordWrap: false, folding: false, indentGuides: false, minimap: false, keymap } });
      send({ type: 'features', features: NO_FEATURES });
    }
    editorContent.current = buffer.content;
    const prev = opened.current;
    const { indent } = await formatting;
    if (pathRef.current !== target) return;
    send({ type: 'open', path: target, content: buffer.content, language: kind === 'large' ? 'plain' : languageFor(target), ...(indent ? { indent } : {}) });
    opened.current = target;
    if (prev !== target) retire(prev);
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
        sendFont();
        sendGestures();
        sendOptions();
        sendFeatures();
        inline.sendCompletions();
        aiFix.sendAiFix();
        openCurrent().then(() => {
          sendMarks();
          sendPaused();
        });
        return;
      case 'change':
        // Only the selected file, the one the WebView still shows while the
        // next loads, or one it just stopped showing. Never a file it isn't
        // showing, e.g. the previous tab after the selected one failed to open.
        if (msg.path !== pathRef.current && msg.path !== opened.current && !retiring.current.has(msg.path)) return;
        if (msg.path === pathRef.current) editorContent.current = msg.content;
        buffersStore.getState().edit(project, msg.path, msg.content);
        return;
      case 'save':
        hostRef.current.save(msg.path);
        return;
      case 'flushed':
        flushes.current.get(msg.id)?.();
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
      case 'peek': {
        const peek = hostRef.current.peek;
        if (!peek) return;
        peek(msg.path, msg.offset)
          .catch(() => null)
          .then((target) => send({ type: 'showPeek', path: msg.path, offset: msg.offset, target }));
        return;
      }
      case 'openAt':
        if (hostRef.current.openAt) hostRef.current.openAt(msg.path, msg.line);
        else if (msg.path === pathRef.current) send({ type: 'goto', path: msg.path, line: msg.line });
        return;
      case 'announce':
        announce(msg.text);
        return;
      case 'cursor':
        selectionStore.setState({ project, path: msg.path, head: msg.offset, anchor: msg.anchor ?? msg.offset });
        hostRef.current.cursor(msg.path, msg.offset);
        return;
      case 'image': {
        // Loaded here, so the file system and sharing modules load only when used.
        const { shareCodeImage } = require('./shareImage') as typeof import('./shareImage');
        shareCodeImage(msg.name, msg.base64).catch((e: Error) => Alert.alert("Couldn't share", e.message));
        return;
      }
      case 'notice':
        Alert.alert(msg.title, msg.message);
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
      case 'actions':
        onActions?.();
        return;
      case 'requestCompletion':
        inline.requestCompletion(msg);
        return;
      case 'completionState':
        onCompletionStateRef.current?.(msg.visible);
        return;
      case 'fixProblem':
        onFixProblemRef.current?.(msg.path, msg.line);
        return;
      case 'error':
        console.warn('Editor error:', msg.message);
        return;
    }
  }

  return (
    <View
      testID="editor-pane"
      style={styles.container}
      // VoiceOver / TalkBack actions: the editor moves to the problem and says what it is.
      accessibilityActions={PROBLEM_ACTIONS}
      onAccessibilityAction={(e) => {
        const direction = e.nativeEvent.actionName === 'nextProblem' ? 1 : e.nativeEvent.actionName === 'previousProblem' ? -1 : 0;
        if (direction) send({ type: 'gotoProblem', direction });
      }}
    >
      {/* The default type argument makes WebView's props `WebViewProps & undefined`, i.e. never. */}
      <WebView<object>
        ref={webview}
        testID="editor"
        source={{ html: editorHtml }}
        originWhitelist={['about:blank']}
        onMessage={onMessage}
        // The web content reloads after a crash, so it has to ask for the file again.
        onContentProcessDidTerminate={() => {
          settleFlushes();
          ready.current = false;
          opened.current = null;
          webview.current?.reload();
        }}
        onLoadStart={() => {
          settleFlushes();
          onCompletionStateRef.current?.(false);
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
      {path && deleted && (
        <View style={styles.deleted} testID="editor-deleted">
          <Text variant="muted" style={styles.deletedText}>
            Deleted on disk. Your changes are kept but not saved.
          </Text>
          <Button
            title="Save as new file"
            variant="outline"
            onPress={() =>
              buffersStore
                .getState()
                .save(project, path, { recreate: true })
                // The file is back, so the tree shows it again.
                .then(() => projectsStore.getState().loadTree(project))
                .catch((e) => console.warn('Save failed', e))
            }
          />
        </View>
      )}
      {path && recoveredTo && !deleted && (
        <View style={styles.deleted} testID="editor-recovered">
          <Text variant="muted" style={styles.deletedText}>
            {`Another file now has this name. Your unsaved edits were kept in ${recoveredTo}.`}
          </Text>
          <Button title="OK" variant="outline" onPress={() => buffersStore.getState().clearRecovered(project, path)} />
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
  deleted: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.secondary,
  },
  deletedText: { flex: 1, fontSize: 13 },
  refused: { textAlign: 'center', paddingHorizontal: spacing.lg },
  empty: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
}));
