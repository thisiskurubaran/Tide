import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { buffersStore, projectsStore, tabsStore, useBuffers, useProjects, useTabs } from '../../state';
import { bufferKey, isDirty } from '../../state/buffers';
import { projectTabs } from '../../state/tabs';
import { borderWidth, colors, spacing } from '../../theme/tokens';
import { FileTree } from '../files/FileTree';
import { EditorHandle, EditorPane } from '../editor/EditorPane';
import { EditorKeyBar } from '../editor/EditorKeyBar';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { TerminalHandle } from '../terminal/TerminalPane';
import { TabBar } from './TabBar';
import { TerminalPanel } from './TerminalPanel';

const DRAWER_MAX = 340;

export function ProjectScreen({ project }: { project: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(DRAWER_MAX, width * 0.85);
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Projects" onPress={() => router.back()} testID="back" />
        <IconButton icon="sidebar" label="Files" onPress={() => setDrawerOpen(true)} testID="open-tree" />
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {project}
        </Text>
      </View>

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
      <View style={[styles.editor, keyboardOpen && typingIn === 'terminal' && styles.collapsed]}>
        <EditorPane
          ref={editor}
          project={project}
          path={tabs.active}
          onBrowse={() => setDrawerOpen(true)}
          onFocusChange={(focused) => focused && setTypingIn('editor')}
        />
      </View>
      <View
        style={[
          styles.terminal,
          { paddingBottom: keyboardOpen ? 0 : insets.bottom },
          keyboardOpen && (typingIn === 'terminal' ? styles.expanded : styles.collapsed),
        ]}
      >
        <TerminalPanel project={project} ref={terminal} onFocusChange={(focused) => focused && setTypingIn('terminal')} />
      </View>
      {keyboardOpen && (
        <View style={{ paddingBottom: keyboardHeight }}>
          {typingIn === 'terminal' ? (
            <TerminalKeyBar input={(data) => terminal.current?.input(data)} onHide={() => terminal.current?.blur()} />
          ) : (
            <EditorKeyBar send={(msg) => editor.current?.send(msg)} />
          )}
        </View>
      )}

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
    </View>
  );
}

const styles = StyleSheet.create({
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
});
