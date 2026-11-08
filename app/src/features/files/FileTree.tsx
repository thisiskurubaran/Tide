import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, TextInput, View } from 'react-native';

import { Action, ActionSheet } from '../../components/ActionSheet';
import { IconButton } from '../../components/Button';
import { FileBadge } from '../../components/FileBadge';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { FileIcon } from '../../extensions/themes';
import { projectsStore, workspace } from '../../state';
import { shareFile } from '../external/share';
import { changeLetter, gitStatusStore, useGitStatus } from '../git/status';
import { borderWidth, fonts, radius, spacing } from '../../theme/tokens';
import { basename, dirname } from './fs';
import { ChangeLetter, filterTree, gitDecorations, TreeRow, visibleRows } from './flatten';
import type { TreeNode } from './workspace';
import { makeStyles, useColors } from '../../theme/theme';
import { haptic } from '../../components/haptics';

type Prompt =
  | { kind: 'new-file' | 'new-folder'; parent: string }
  | { kind: 'rename'; path: string }
  | { kind: 'move'; path: string };

interface FileTreeProps {
  project: string;
  nodes: TreeNode[];
  activePath: string | null;
  onOpenFile(path: string): void;
  // Set (with a new nonce each time) to open a file's folders, scroll to it and highlight it.
  reveal?: { path: string; nonce: number } | null;
}

// Desktop-explorer density: short rows, 16pt per level. Rows sit flush so the
// indent guides join up; hitSlop keeps taps forgiving without spacing them out.
const ROW_HEIGHT = 30;
const INDENT = 16;
const PAD = spacing.sm;
const CHEVRON = 14;
const ROW_SLOP = { top: 4, bottom: 4, left: 0, right: 0 };
// How long a revealed file stays highlighted.
const REVEAL_MS = 1500;

// "src/lib/a.ts" -> ["src", "src/lib"]
const ancestors = (path: string) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));

export function FileTree({ project, nodes, activePath, onOpenFile, reveal }: FileTreeProps) {
  const styles = useStyles();
  const colors = useColors();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // While filtering every folder with a match is open; these are the ones
  // the user closed, forgotten when the query changes.
  const [filterClosed, setFilterClosed] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<TreeNode | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const store = projectsStore.getState();
  const changes = useGitStatus((s) => s.byProject[project]?.changes);

  // Colors are only as fresh as the last status, so read it when the tree opens.
  useEffect(() => {
    void gitStatusStore.getState().refresh(project);
  }, [project]);

  const filtering = query.trim().length > 0;
  const filtered = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const open = useMemo(
    () => (filtering ? new Set([...filtered.expand].filter((p) => !filterClosed.has(p))) : expanded),
    [filtering, filtered, filterClosed, expanded],
  );
  const rows = useMemo(() => visibleRows(filtered.nodes, open), [filtered, open]);
  const git = useMemo(() => gitDecorations(changes, changeLetter), [changes]);

  // Reveal: clear the filter, open the folders above the file, then scroll to
  // it once its row is in the list, and highlight it for a moment.
  const list = useRef<FlatList<TreeRow>>(null);
  const scrollTo = useRef<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!reveal) return;
    setQuery('');
    setFilterClosed(new Set());
    setExpanded((prev) => new Set([...prev, ...ancestors(reveal.path)]));
    scrollTo.current = reveal.path;
    setFlash(reveal.path);
    const t = setTimeout(() => setFlash(null), REVEAL_MS);
    return () => clearTimeout(t);
  }, [reveal?.path, reveal?.nonce]);
  useEffect(() => {
    const target = scrollTo.current;
    if (!target) return;
    const index = rows.findIndex((r) => r.kind === 'node' && r.node.path === target);
    if (index === -1) return;
    scrollTo.current = null;
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, [rows]);

  const flip = (set: Set<string>, path: string) => {
    const next = new Set(set);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  };
  const toggle = (path: string) => (filtering ? setFilterClosed((s) => flip(s, path)) : setExpanded((s) => flip(s, path)));
  const expand = (path: string) => setExpanded((prev) => new Set(prev).add(path));

  function changeQuery(text: string) {
    setQuery(text);
    setFilterClosed(new Set());
  }

  function refresh() {
    void store.loadTree(project);
    void gitStatusStore.getState().refresh(project);
  }

  function collapseAll() {
    setExpanded(new Set());
    if (filtering) setFilterClosed(new Set(filtered.expand));
  }

  function confirmDelete(node: TreeNode) {
    haptic('warning');
    const what = node.kind === 'dir' ? 'folder and everything in it' : 'file';
    Alert.alert(`Delete ${node.name}?`, `This deletes the ${what}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => store.deleteEntry(project, node.path).catch((e: Error) => Alert.alert(`Couldn't delete ${node.name}`, e.message)),
      },
    ]);
  }

  // "name copy.ext" beside the file (or "name copy 2.ext"...), opened right away.
  async function duplicate(node: TreeNode) {
    try {
      const target = await workspace.duplicatePath(project, node.path);
      await store.copyEntry(project, node.path, target);
      onOpenFile(target);
      void gitStatusStore.getState().refresh(project);
    } catch (e) {
      Alert.alert(`Couldn't duplicate ${node.name}`, e instanceof Error ? e.message : String(e));
    }
  }

  function actionsFor(node: TreeNode): Action[] {
    const common: Action[] = [
      { label: 'Rename', icon: 'edit-2', onPress: () => setPrompt({ kind: 'rename', path: node.path }) },
      { label: 'Move to…', icon: 'corner-down-right', onPress: () => setPrompt({ kind: 'move', path: node.path }) },
      ...(node.kind === 'file' ? [{ label: 'Duplicate', icon: 'copy' as const, onPress: () => void duplicate(node) }] : []),
      {
        label: 'Copy path',
        icon: 'clipboard',
        onPress: () => {
          void Clipboard.setStringAsync(node.path);
          haptic('success');
        },
      },
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

  const letterColor: Record<ChangeLetter, string> = { M: colors.warning, U: colors.success, D: colors.destructive };

  // One faint line per ancestor level, under the chevron column.
  const guides = (depth: number) =>
    Array.from({ length: depth }, (_, d) => <View key={d} style={[styles.guide, { left: PAD + d * INDENT + CHEVRON / 2 }]} />);

  function renderRow({ item }: { item: TreeRow }) {
    if (item.kind === 'unlisted')
      return (
        <View style={[styles.row, { paddingLeft: PAD + item.depth * INDENT + CHEVRON + spacing.xs }]}>
          {guides(item.depth)}
          <Text variant="muted" style={styles.unlisted}>
            Contents not listed
          </Text>
        </View>
      );
    const { node, depth } = item;
    const isDir = node.kind === 'dir';
    const isOpen = open.has(node.path);
    const active = node.path === activePath;
    const letter = isDir ? null : git.letterFor(node.path);
    const dirty = isDir && git.isDirty(node.path);
    const tint = letter ? letterColor[letter] : undefined;
    return (
      <Pressable
        testID={`tree-${node.path}`}
        onPress={() => (isDir ? toggle(node.path) : onOpenFile(node.path))}
        onLongPress={() => setMenuFor(node)}
        hitSlop={ROW_SLOP}
        accessibilityRole="button"
        accessibilityLabel={`${node.name}, ${isDir ? 'folder' : 'file'}${letter ? `, ${LETTER_NAMES[letter]}` : ''}${dirty ? ', has changes' : ''}`}
        accessibilityState={{ expanded: isDir ? isOpen : undefined, selected: active }}
        // Long press opens the menu; screen readers get it as an action.
        accessibilityActions={[{ name: 'longpress', label: 'More actions' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(node)}
        style={({ pressed }) => [
          styles.row,
          { paddingLeft: PAD + depth * INDENT },
          (active || pressed) && { backgroundColor: active ? colors.brandSoft : colors.secondary },
          node.path === flash && [styles.revealed, { borderColor: colors.brand }],
        ]}
      >
        {guides(depth)}
        {isDir ? (
          <Feather name={isOpen ? 'chevron-down' : 'chevron-right'} size={CHEVRON} color={colors.mutedForeground} style={styles.chevron} />
        ) : (
          <View style={styles.chevron} />
        )}
        {isDir ? (
          <Feather name="folder" size={15} color={colors.brand} />
        ) : (
          <FileIcon name={node.name} fallback={<FileBadge name={node.name} size={15} />} />
        )}
        <Text numberOfLines={1} style={[styles.name, active && styles.activeName, tint ? { color: tint } : null, letter === 'D' && styles.deleted]}>
          {node.name}
        </Text>
        {dirty && <View style={[styles.dot, { backgroundColor: colors.warning }]} />}
        {letter && <Text style={[styles.letter, { color: tint }]}>{letter}</Text>}
      </Pressable>
    );
  }

  const promptTitle = !prompt
    ? ''
    : prompt.kind === 'rename'
      ? `Rename ${basename(prompt.path)}`
      : prompt.kind === 'move'
        ? `Move ${basename(prompt.path)} to folder`
        : `New ${prompt.kind === 'new-file' ? 'file' : 'folder'}${prompt.parent ? ` in ${prompt.parent}` : ''}`;

  const initialValue = prompt?.kind === 'rename' ? basename(prompt.path) : prompt?.kind === 'move' ? dirname(prompt.path) : '';

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {project}
        </Text>
        <IconButton icon="file-plus" label="New file" onPress={() => setPrompt({ kind: 'new-file', parent: '' })} testID="tree-new-file" />
        <IconButton icon="folder-plus" label="New folder" onPress={() => setPrompt({ kind: 'new-folder', parent: '' })} testID="tree-new-folder" />
        <IconButton icon="refresh-cw" label="Refresh" onPress={refresh} testID="tree-refresh" />
        <IconButton icon="minus-square" label="Collapse all folders" onPress={collapseAll} testID="tree-collapse-all" />
      </View>

      <View style={styles.filter}>
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          testID="tree-filter"
          value={query}
          onChangeText={changeQuery}
          placeholder="Filter files"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Filter files"
          style={styles.filterInput}
        />
        {query.length > 0 && (
          <Pressable testID="tree-filter-clear" onPress={() => changeQuery('')} hitSlop={spacing.sm} accessibilityRole="button" accessibilityLabel="Clear filter">
            <Feather name="x-circle" size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {/* Virtualized: a big project can have thousands of rows open. */}
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(row) => (row.kind === 'node' ? row.node.path : `${row.path}\u0000unlisted`)}
        renderItem={renderRow}
        extraData={[activePath, git, flash]}
        // Rows that aren't laid out yet: jump near by row height, then try again.
        onScrollToIndexFailed={({ index }) => {
          list.current?.scrollToOffset({ offset: index * ROW_HEIGHT, animated: false });
          setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }), 50);
        }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={40}
        maxToRenderPerBatch={40}
        windowSize={11}
        ListEmptyComponent={
          <Text variant="muted" style={styles.empty}>
            {filtering ? `No files match “${query.trim()}”.` : 'This project is empty.'}
          </Text>
        }
      />

      <ActionSheet title={menuFor?.path ?? null} actions={menuFor ? actionsFor(menuFor) : []} onClose={() => setMenuFor(null)} />

      <PromptSheet
        visible={prompt !== null}
        title={promptTitle}
        initialValue={initialValue}
        placeholder={prompt?.kind === 'move' ? 'folder (empty for the project root)' : prompt?.kind === 'new-folder' ? 'folder' : 'file.js'}
        confirmLabel={prompt?.kind === 'rename' ? 'Rename' : prompt?.kind === 'move' ? 'Move' : 'Create'}
        onClose={() => setPrompt(null)}
        onSubmit={async (value) => {
          if (!prompt) return;
          if (prompt.kind === 'rename') {
            await store.renameEntry(project, prompt.path, value);
            return;
          }
          if (prompt.kind === 'move') {
            // The prompt asks for a folder; the store wants the full new path.
            const folder = value.trim().replace(/^\/+|\/+$/g, '');
            const target = folder ? `${folder}/${basename(prompt.path)}` : basename(prompt.path);
            if (target === prompt.path) return;
            await store.moveEntry(project, prompt.path, target);
            if (folder) expand(folder);
            void gitStatusStore.getState().refresh(project);
            return;
          }
          if (prompt.parent) expand(prompt.parent);
          if (prompt.kind === 'new-folder') {
            await store.createFolder(project, prompt.parent, value);
          } else {
            onOpenFile(await store.createFile(project, prompt.parent, value));
          }
          void gitStatusStore.getState().refresh(project);
        }}
      />
    </View>
  );
}

const LETTER_NAMES: Record<ChangeLetter, string> = { M: 'modified', U: 'untracked', D: 'deleted' };

const useStyles = makeStyles((colors) => ({
  container: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  title: { flex: 1, fontFamily: fonts.heading.semibold, fontSize: 15 },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 32,
    borderRadius: radius.sm,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
  },
  filterInput: { flex: 1, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: 13, paddingVertical: spacing.xs },
  list: { paddingHorizontal: spacing.xs, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: ROW_HEIGHT,
    paddingRight: spacing.sm,
    borderRadius: radius.sm - 3,
  },
  chevron: { width: CHEVRON, marginRight: -2 },
  guide: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  name: { flex: 1, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: 13.5 },
  activeName: { fontFamily: fonts.sans.medium },
  revealed: { borderWidth },
  deleted: { textDecorationLine: 'line-through' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  letter: { fontFamily: fonts.mono.semibold, fontSize: 12, minWidth: 10, textAlign: 'right' },
  empty: { padding: spacing.md },
  unlisted: { fontSize: 12.5 },
}));
