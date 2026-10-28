import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { projectsStore, tabsStore, useProjects, useTabs } from '../../state';
import { projectTabs } from '../../state/tabs';
import { borderWidth, colors, spacing } from '../../theme/tokens';
import { FileTree } from '../files/FileTree';
import { FileView } from './FileView';
import { TabBar } from './TabBar';
import { TerminalPanel } from './TerminalPanel';

const DRAWER_MAX = 340;

export function ProjectScreen({ project }: { project: string }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(DRAWER_MAX, width * 0.85);
  const tree = useProjects((s) => s.trees[project]);
  const tabs = useTabs((s) => projectTabs(s, project));
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
        onClose={(path) => tabsStore.getState().closeTab(project, path)}
      />

      <View style={styles.editor}>
        <FileView project={project} path={tabs.active} onBrowse={() => setDrawerOpen(true)} />
      </View>
      <View style={[styles.terminal, { paddingBottom: insets.bottom }]}>
        <TerminalPanel />
      </View>

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
