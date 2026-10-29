import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { answerRequest, editorFeatures, findDefinition, saveWithHooks, useActiveExtensions, useExtensionHost } from '../../extensions/host';
import { GIT_PRO_PANEL } from '../../extensions/gitPro';
import type { ProjectContext } from '../../extensions/types';
import { buffersStore, projectsStore, runnerStore, tabsStore, useBuffers, useProjects, useTabs } from '../../state';
import { bufferKey, isDirty } from '../../state/buffers';
import { projectTabs } from '../../state/tabs';
import { borderWidth, spacing } from '../../theme/tokens';
import { FileTree } from '../files/FileTree';
import { EditorHandle, EditorHost, EditorPane } from '../editor/EditorPane';
import { EditorKeyBar } from '../editor/EditorKeyBar';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { TerminalHandle } from '../terminal/TerminalPane';
import { SourceControlSheet } from '../git/SourceControlSheet';
import { Command, CommandPalette } from '../search/CommandPalette';
import { SearchPanel } from '../search/SearchPanel';
import type { Shortcut } from './shortcuts';
import { TabBar } from './TabBar';
import { TerminalPanel } from './TerminalPanel';
import { makeStyles } from '../../theme/theme';

// Extensions can contribute the same command or panel (Show problems); the first one wins.
const uniqueById = <T extends { id: string }>(items: T[]) => items.filter((x, i) => items.findIndex((o) => o.id === x.id) === i);

const DRAWER_MAX = 340;
// iPad portrait and wider: the file tree stays open beside the editor.
const WIDE = 768;
const SIDEBAR_WIDTH = 280;

export function ProjectScreen({ project }: { project: string }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(DRAWER_MAX, width * 0.85);
  const wide = width >= WIDE;
  const tree = useProjects((s) => s.trees[project]);
  const tabs = useTabs((s) => projectTabs(s, project));
  const dirtyKey = useBuffers((s) =>
    tabs.open.filter((p) => isDirty(s.buffers[bufferKey(project, p)])).join('\n'),
  );
  const dirty = new Set(dirtyKey ? dirtyKey.split('\n') : []);
  const editor = useRef<EditorHandle>(null);
  const terminal = useRef<TerminalHandle>(null);
  const keyboardHeight = useKeyboardHeight();
  // The pane that last took focus gets the space above the keyboard.
  const [typingIn, setTypingIn] = useState<'editor' | 'terminal'>('editor');
  const keyboardOpen = keyboardHeight > 0;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [palette, setPalette] = useState<'files' | 'commands' | null>(null);
  const [searching, setSearching] = useState(false);
  const [goingToLine, setGoingToLine] = useState(false);
  const [terminalHidden, setTerminalHidden] = useState(false);
  const [sourceControl, setSourceControl] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const activePath = useRef(tabs.active);
  activePath.current = tabs.active;
  const cursor = useRef<{ path: string; offset: number } | null>(null);
  const extensions = useActiveExtensions();
  const features = useMemo(() => editorFeatures(extensions), [extensions]);
  // Git Pro's screen stands in for the Source Control sheet.
  const openSourceControl = () => (extensions.some((e) => e.id === 'git-pro') ? setPanel(GIT_PRO_PANEL) : setSourceControl(true));

  useEffect(() => {
    projectsStore.getState().loadTree(project);
    tabsStore.getState().setLastProject(project);
    // Leaving the screen means the list is home again on the next launch.
    return () => tabsStore.getState().setLastProject(null);
  }, [project]);

  useEffect(() => {
    Animated.timing(progress, { toValue: drawerOpen ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [drawerOpen, progress]);

  const openFile = (path: string) => {
    tabsStore.getState().openTab(project, path);
    setDrawerOpen(false);
  };

  const openAt = (path: string, line: number, column?: number) => {
    openFile(path);
    editor.current?.reveal(path, line, column);
  };

  const save = (path: string) => saveWithHooks(extensions, ctx, path);

  const ctx: ProjectContext = {
    project,
    activePath: () => activePath.current,
    cursor: () => (cursor.current && cursor.current.path === activePath.current ? cursor.current.offset : null),
    openFile: (path, line, column) => (line ? openAt(path, line, column) : openFile(path)),
    editor: () => editor.current,
    openPanel: (id) => setPanel(id),
    save,
  };
  useExtensionHost(extensions, ctx, tabs.open);

  const editorHost: EditorHost = {
    request: (req) => answerRequest(extensions, project, req),
    async definition(path, offset) {
      const [target] = await findDefinition(extensions, project, path, offset);
      if (target) openAt(target.path, target.line, target.column);
    },
    cursor: (path, offset) => {
      cursor.current = { path, offset };
    },
    save: (path) => {
      save(path).catch((e) => console.warn('Save failed', e));
    },
  };

  const commands = uniqueById<Command>([
    { id: 'quick-open', title: 'Open file', icon: 'file', hint: '⌘P', run: () => setPalette('files') },
    { id: 'search', title: 'Search in project', icon: 'search', hint: '⇧⌘F', run: () => setSearching(true) },
    { id: 'find', title: 'Find in file', icon: 'search', hint: '⌘F', run: () => editor.current?.send({ type: 'find' }) },
    { id: 'goto-line', title: 'Go to line', icon: 'corner-down-right', hint: '⌘L', run: () => tabs.active && setGoingToLine(true) },
    { id: 'save', title: 'Save file', icon: 'save', hint: '⌘S', run: () => tabs.active && save(tabs.active) },
    {
      id: 'close-tab',
      title: 'Close file',
      icon: 'x',
      run: async () => {
        if (!tabs.active) return;
        await buffersStore.getState().save(project, tabs.active);
        tabsStore.getState().closeTab(project, tabs.active);
      },
    },
    { id: 'undo', title: 'Undo', icon: 'rotate-ccw', run: () => editor.current?.send({ type: 'undo' }) },
    { id: 'redo', title: 'Redo', icon: 'rotate-cw', run: () => editor.current?.send({ type: 'redo' }) },
    { id: 'files', title: 'Show files', icon: 'sidebar', run: () => !wide && setDrawerOpen(true) },
    { id: 'toggle-terminal', title: 'Toggle terminal', icon: 'terminal', hint: '⌘J', run: () => setTerminalHidden((h) => !h) },
    { id: 'local', title: 'Terminal: use Local', icon: 'smartphone', run: () => runnerStore.getState().setMode('local') },
    { id: 'remote', title: 'Terminal: use Remote', icon: 'server', run: () => runnerStore.getState().setMode('remote') },
    { id: 'source-control', title: 'Source control', icon: 'git-branch', run: openSourceControl },
    { id: 'settings', title: 'Settings', icon: 'settings', run: () => router.push('/settings') },
    { id: 'extensions', title: 'Extensions', icon: 'package', run: () => router.push('/extensions') },
    ...extensions.flatMap((ext) => ext.commands?.(ctx) ?? []),
  ]);
  const panels = uniqueById(extensions.flatMap((ext) => ext.panels ?? []));

  // Hardware keyboard shortcuts arrive from whichever WebView has focus.
  const onShortcut = (id: Shortcut) => {
    if (id === 'palette') setPalette('commands');
    else commands.find((c) => c.id === id)?.run();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Projects" onPress={() => router.back()} testID="back" />
        {!wide && <IconButton icon="sidebar" label="Files" onPress={() => setDrawerOpen(true)} testID="open-tree" />}
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {project}
        </Text>
        <IconButton icon="git-branch" label="Source control" onPress={openSourceControl} testID="open-source-control" />
        <IconButton icon="search" label="Search in project" onPress={() => setSearching(true)} testID="open-search" />
        <IconButton icon="command" label="Commands" onPress={() => setPalette('commands')} testID="open-palette" />
      </View>

      <View style={[styles.body, wide && styles.row]}>
        {wide && (
          <View style={[styles.sidebar, { paddingBottom: insets.bottom }]} testID="sidebar">
            <FileTree project={project} nodes={tree ?? []} activePath={tabs.active} onOpenFile={openFile} />
          </View>
        )}
        <View style={styles.body}>
          <TabBar
            open={tabs.open}
            active={tabs.active}
            onSelect={(path) => tabsStore.getState().openTab(project, path)}
            dirty={dirty}
            onClose={async (path) => {
              await buffersStore.getState().save(project, path);
              tabsStore.getState().closeTab(project, path);
            }}
          />

          {/* Both panes stay mounted so the terminal keeps its scrollback and the editor its undo history. */}
          <View style={[styles.editor, keyboardOpen && typingIn === 'terminal' && !terminalHidden && styles.collapsed]}>
            <EditorPane
              ref={editor}
              project={project}
              path={tabs.active}
              features={features}
              host={editorHost}
              onBrowse={() => (wide ? setPalette('files') : setDrawerOpen(true))}
              onFocusChange={(focused) => focused && setTypingIn('editor')}
              onShortcut={onShortcut}
            />
          </View>
          <View
            style={[
              styles.terminal,
              { paddingBottom: keyboardOpen ? 0 : insets.bottom },
              keyboardOpen && (typingIn === 'terminal' ? styles.expanded : styles.collapsed),
              terminalHidden && styles.collapsed,
            ]}
          >
            <TerminalPanel
              project={project}
              ref={terminal}
              onFocusChange={(focused) => focused && setTypingIn('terminal')}
              onShortcut={onShortcut}
            />
          </View>
        </View>
      </View>
      {keyboardOpen && (
        <View style={{ paddingBottom: keyboardHeight }}>
          {typingIn === 'terminal' && !terminalHidden ? (
            <TerminalKeyBar input={(data) => terminal.current?.input(data)} onHide={() => terminal.current?.blur()} />
          ) : (
            <EditorKeyBar send={(msg) => editor.current?.send(msg)} />
          )}
        </View>
      )}

      {!wide && (
        <>
          <Animated.View
            pointerEvents={drawerOpen ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) }]}
          >
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} accessibilityLabel="Close files" />
          </Animated.View>
          <Animated.View
            pointerEvents={drawerOpen ? 'auto' : 'none'}
            style={[
              styles.drawer,
              {
                width: drawerWidth,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }],
              },
            ]}
          >
            <FileTree project={project} nodes={tree ?? []} activePath={tabs.active} onOpenFile={openFile} />
          </Animated.View>
        </>
      )}

      <CommandPalette mode={palette} project={project} commands={commands} onOpenFile={openFile} onClose={() => setPalette(null)} />
      <SourceControlSheet visible={sourceControl} project={project} onClose={() => setSourceControl(false)} />
      {panels.map(({ id, component: Panel }) => (
        <Panel key={id} ctx={ctx} visible={panel === id} onClose={() => setPanel((p) => (p === id ? null : p))} />
      ))}
      <SearchPanel visible={searching} project={project} onOpen={openAt} onClose={() => setSearching(false)} />
      <PromptSheet
        visible={goingToLine}
        title="Go to line"
        placeholder="Line number"
        confirmLabel="Go"
        keyboardType="number-pad"
        onSubmit={async (value) => {
          const line = Number.parseInt(value, 10);
          if (!Number.isFinite(line) || line < 1) throw new Error('Enter a line number');
          if (tabs.active) editor.current?.reveal(tabs.active, line);
        }}
        onClose={() => setGoingToLine(false)}
      />
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
  body: { flex: 1 },
  row: { flexDirection: 'row' },
  sidebar: { width: SIDEBAR_WIDTH, borderRightWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  editor: { flex: 3 },
  terminal: { flex: 2 },
  expanded: { flex: 1 },
  // Kept mounted but out of the layout while the other pane is being typed in.
  collapsed: { flex: 0, height: 0, overflow: 'hidden' },
  backdrop: { backgroundColor: colors.background },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.card,
    borderRightWidth: borderWidth,
    borderColor: colors.border,
  },
}));
