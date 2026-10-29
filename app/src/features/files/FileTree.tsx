import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';

import { Action, ActionSheet } from '../../components/ActionSheet';
import { IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { FileIcon } from '../../extensions/themes';
import { projectsStore } from '../../state';
import { shareFile } from '../external/share';
import { radius, spacing } from '../../theme/tokens';
import { basename } from './fs';
import { TreeRow, visibleRows } from './flatten';
import type { TreeNode } from './workspace';
import { makeStyles, useColors } from '../../theme/theme';
import { haptic } from '../../components/haptics';

type Prompt =
  | { kind: 'new-file' | 'new-folder'; parent: string }
  | { kind: 'rename'; path: string };

interface FileTreeProps {
  project: string;
  nodes: TreeNode[];
  activePath: string | null;
  onOpenFile(path: string): void;
}

const INDENT = spacing.md;

export function FileTree({ project, nodes, activePath, onOpenFile }: FileTreeProps) {
  const styles = useStyles();
  const colors = useColors();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<TreeNode | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const store = projectsStore.getState();

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const expand = (path: string) => setExpanded((prev) => new Set(prev).add(path));

  function confirmDelete(node: TreeNode) {
    haptic('warning');
    const what = node.kind === 'dir' ? 'folder and everything in it' : 'file';
    Alert.alert(`Delete ${node.name}?`, `This deletes the ${what}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => store.deleteEntry(project, node.path) },
    ]);
  }

  function actionsFor(node: TreeNode): Action[] {
    const common: Action[] = [
      { label: 'Rename', icon: 'edit-2', onPress: () => setPrompt({ kind: 'rename', path: node.path }) },
      { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmDelete(node) },
    ];
    if (node.kind === 'file')
      return [
        {
          label: 'Share',
          icon: 'share',
          onPress: () => shareFile(project, node.path).catch((e: Error) => Alert.alert("Couldn't share", e.message)),
        },
        ...common,
      ];
    return [
      { label: 'New file', icon: 'file-plus', onPress: () => setPrompt({ kind: 'new-file', parent: node.path }) },
      { label: 'New folder', icon: 'folder-plus', onPress: () => setPrompt({ kind: 'new-folder', parent: node.path }) },
      ...common,
    ];
  }

  const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);

  function renderRow({ item }: { item: TreeRow }) {
    if (item.kind === 'unlisted')
      return (
        <Text variant="muted" style={[styles.unlisted, { paddingLeft: spacing.sm + item.depth * INDENT }]}>
          Contents not listed
        </Text>
      );
    const { node, depth } = item;
    const isDir = node.kind === 'dir';
    const open = expanded.has(node.path);
    const active = node.path === activePath;
    return (
      <Pressable
        testID={`tree-${node.path}`}
        onPress={() => (isDir ? toggle(node.path) : onOpenFile(node.path))}
        onLongPress={() => setMenuFor(node)}
        accessibilityRole="button"
        accessibilityLabel={`${node.name}, ${isDir ? 'folder' : 'file'}`}
        accessibilityState={{ expanded: isDir ? open : undefined, selected: active }}
        // Long press opens the menu; screen readers get it as an action.
        accessibilityActions={[{ name: 'longpress', label: 'More actions' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(node)}
        style={({ pressed }) => [
          styles.row,
          { paddingLeft: spacing.sm + depth * INDENT },
          (active || pressed) && { backgroundColor: active ? colors.brandSoft : colors.secondary },
        ]}
      >
        {isDir ? (
          <Feather name={open ? 'chevron-down' : 'chevron-right'} size={16} color={colors.mutedForeground} />
        ) : (
          <FileIcon name={node.name} fallback={<Feather name="file-text" size={16} color={active ? colors.brand : colors.mutedForeground} />} />
        )}
        {isDir && <Feather name="folder" size={16} color={colors.brand} />}
        <Text variant="label" numberOfLines={1} style={styles.name}>
          {node.name}
        </Text>
      </Pressable>
    );
  }

  const promptTitle = !prompt
    ? ''
    : prompt.kind === 'rename'
      ? `Rename ${basename(prompt.path)}`
      : `New ${prompt.kind === 'new-file' ? 'file' : 'folder'}${prompt.parent ? ` in ${prompt.parent}` : ''}`;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {project}
        </Text>
        <IconButton icon="file-plus" label="New file" onPress={() => setPrompt({ kind: 'new-file', parent: '' })} testID="tree-new-file" />
        <IconButton icon="folder-plus" label="New folder" onPress={() => setPrompt({ kind: 'new-folder', parent: '' })} testID="tree-new-folder" />
        <IconButton icon="refresh-cw" label="Refresh" onPress={() => store.loadTree(project)} />
      </View>
      {/* Virtualized: a big project can have thousands of rows open. */}
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'node' ? row.node.path : `${row.path}\u0000unlisted`)}
        renderItem={renderRow}
        extraData={activePath}
        contentContainerStyle={styles.list}
        initialNumToRender={40}
        maxToRenderPerBatch={40}
        windowSize={11}
        ListEmptyComponent={<Text variant="muted" style={styles.empty}>This project is empty.</Text>}
      />

      <ActionSheet title={menuFor?.path ?? null} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />

      <PromptSheet
        visible={prompt !== null}
        title={promptTitle}
        initialValue={prompt?.kind === 'rename' ? basename(prompt.path) : ''}
        placeholder={prompt?.kind === 'new-folder' ? 'folder' : 'file.js'}
        confirmLabel={prompt?.kind === 'rename' ? 'Rename' : 'Create'}
        onClose={() => setPrompt(null)}
        onSubmit={async (value) => {
          if (!prompt) return;
          if (prompt.kind === 'rename') {
            await store.renameEntry(project, prompt.path, value);
            return;
          }
          if (prompt.parent) expand(prompt.parent);
          if (prompt.kind === 'new-folder') {
            await store.createFolder(project, prompt.parent, value);
          } else {
            onOpenFile(await store.createFile(project, prompt.parent, value));
          }
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  title: { flex: 1 },
  list: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm,
    paddingRight: spacing.sm,
    borderRadius: radius.sm,
  },
  name: { flex: 1 },
  empty: { padding: spacing.md },
  unlisted: { paddingVertical: spacing.xs },
}));
