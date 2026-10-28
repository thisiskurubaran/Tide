import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { buffersStore, projectsStore, runnerStore, tabsStore, useBuffers, useProjects, useTabs } from '../../state';
import { bufferKey, isDirty } from '../../state/buffers';
import { projectTabs } from '../../state/tabs';
import { borderWidth, spacing } from '../../theme/tokens';
import { FileTree } from '../files/FileTree';
import { EditorHandle, EditorPane } from '../editor/EditorPane';
import { EditorKeyBar } from '../editor/EditorKeyBar';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { TerminalHandle } from '../terminal/TerminalPane';
import { Command, CommandPalette } from '../search/CommandPalette';
import { SearchPanel } from '../search/SearchPanel';
import type { Shortcut } from './shortcuts';
import { TabBar } from './TabBar';
import { TerminalPanel } from './TerminalPanel';
import { makeStyles } from '../../theme/theme';

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
  const progress = useRef(new Animated.Value(0)).current;

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

  const openAt = (path: string, line: number) => {
    openFile(path);
    editor.current?.reveal(path, line);
  };

  const commands: Command[] = [
    { id: 'quick-open', title: 'Open file', icon: 'file', hint: '⌘P', run: () => setPalette('files') },
    { id: 'search', title: 'Search in project', icon: 'search', hint: '⇧⌘F', run: () => setSearching(true) },
    { id: 'find', title: 'Find in file', icon: 'search', hint: '⌘F', run: () => editor.current?.send({ type: 'find' }) },
    { id: 'goto-line', title: 'Go to line', icon: 'corner-down-right', hint: '⌘L', run: () => tabs.active && setGoingToLine(true) },
    { id: 'save', title: 'Save file', icon: 'save', hint: '⌘S', run: () => tabs.active && buffersStore.getState().save(project, tabs.active) },
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
    { id: 'settings', title: 'Settings', icon: 'settings', run: () => router.push('/settings') },
  ];

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
