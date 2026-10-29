import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { answerRequest, editorFeatures, findDefinition, saveWithHooks, useActiveExtensions, useExtensionHost } from '../../extensions/host';
import { GIT_PRO_PANEL } from '../../extensions/gitPro';
import type { ProjectContext } from '../../extensions/types';
import { buffersStore, projectsStore, runnerStore, snapshots, tabsStore, useBuffers, useProjects, useRunner, useTabs, workspace } from '../../state';
import { bufferKey, isDirty } from '../../state/buffers';
import { projectTabs } from '../../state/tabs';
import { borderWidth, spacing } from '../../theme/tokens';
import { exportProject } from '../backup/actions';
import { SnapshotsSheet } from '../backup/SnapshotsSheet';
import { pullFolder, pushFolder, useLinked } from '../external';
import { LinkedFolderSheet } from '../external/LinkedFolderSheet';
import { shareFile } from '../external/share';
import { FileTree } from '../files/FileTree';
import { EditorHandle, EditorHost, EditorPane } from '../editor/EditorPane';
import { languageFor } from '../editor/bridge';
import { EditorKeyBar } from '../editor/EditorKeyBar';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { SourceControlSheet } from '../git/SourceControlSheet';
import { Command, CommandPalette } from '../search/CommandPalette';
import { SearchPanel } from '../search/SearchPanel';
import { projectLink, ProjectLinkOptions } from '../launch/links';
import { configLine, DEFAULT_CONFIG, NamedConfig, taskLine, Task } from './tasks';
import { useProjectTasks } from './useProjectTasks';
import type { Shortcut } from './shortcuts';
import { ShortcutsSheet } from './ShortcutsSheet';
import { SplitDivider } from './SplitDivider';
import { TabBar } from './TabBar';
import { TerminalPanel, TerminalPanelHandle } from './TerminalPanel';
import { makeStyles } from '../../theme/theme';
import { haptic } from '../../components/haptics';
import { countRun } from '../support/actions';
import { PreviewPane } from '../preview/PreviewPane';
import { previewKind } from '../preview/render';
import { hasConflicts } from '../diff/conflicts';
import { CompareView } from '../diff/CompareView';
import type { CompareRequest } from '../diff/sources';
import { PackagesSheet } from '../packages/PackagesSheet';
import { isJsTestFile, isPyTestFile } from '../tests/results';
import { TestsRequest, TestsSheet } from '../tests/TestsSheet';
import { useReduceMotion } from '../../components/a11y';

// Extensions can contribute the same command or panel (Show problems); the first one wins.
const uniqueById = <T extends { id: string }>(items: T[]) => items.filter((x, i) => items.findIndex((o) => o.id === x.id) === i);

const SNAPSHOT_DELAY_MS = 3000;
const LAUNCH_RUN_DELAY_MS = 1000;
const NEW_TERMINAL_DELAY_MS = 800;
const DRAWER_MAX = 340;
// iPad portrait and wider: the file tree stays open beside the editor.
const WIDE = 768;
const SIDEBAR_WIDTH = 280;

// `launch` comes from a tide:// link or quick action: a file to open, and whether to run.
export function ProjectScreen({ project, launch }: { project: string; launch?: ProjectLinkOptions | null }) {
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
  const leftEditor = useRef<EditorHandle>(null);
  const rightEditor = useRef<EditorHandle>(null);
  // iPad: a second editor beside the first. `path` is its file; the focused
  // pane is where opened files, the key bar and editor commands go.
  const [split, setSplit] = useState<{ path: string | null } | null>(null);
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [editorWidth, setEditorWidth] = useState(0);
  const splitOn = wide && split !== null;
  const rightFocused = splitOn && focusedPane === 'right';
  // The file in the focused pane.
  const current = rightFocused ? split.path : tabs.active;
  const editor = { current: rightFocused ? rightEditor.current : leftEditor.current };
  const terminal = useRef<TerminalPanelHandle>(null);
  const keyboardHeight = useKeyboardHeight();
  // The pane that last took focus gets the space above the keyboard.
  const [typingIn, setTypingIn] = useState<'editor' | 'terminal'>('editor');
  const keyboardOpen = keyboardHeight > 0;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [palette, setPalette] = useState<'files' | 'commands' | null>(null);
  const [searching, setSearching] = useState(false);
  const [goingToLine, setGoingToLine] = useState(false);
  const [terminalHidden, setTerminalHidden] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sourceControl, setSourceControl] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  const reduceMotion = useReduceMotion();
  const [compare, setCompare] = useState<CompareRequest | null>(null);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [tests, setTests] = useState<TestsRequest | null>(null);
  // "Compare with file…" uses the file picker; the next pick is the other file.
  const comparingWith = useRef<string | null>(null);
  const currentHasConflicts = useBuffers((s) => (current ? hasConflicts(s.buffers[bufferKey(project, current)]?.content ?? '') : false));
  // Files shown rendered instead of as source. Notebooks start out rendered.
  const [previewToggled, setPreviewToggled] = useState<Record<string, boolean>>({});
  const previewing = (path: string | null) => !!path && !!previewKind(path) && (previewToggled[path] ?? previewKind(path) === 'notebook');
  const togglePreview = () => current && previewKind(current) && setPreviewToggled((t) => ({ ...t, [current]: !previewing(current) }));
  const linked = useLinked((s) => s.links[project]?.name);
  const progress = useRef(new Animated.Value(0)).current;
  const activePath = useRef(current);
  activePath.current = current;
  const cursor = useRef<{ path: string; offset: number } | null>(null);
  const extensions = useActiveExtensions();
  const features = useMemo(() => editorFeatures(extensions), [extensions]);
  // Git Pro's screen stands in for the Source Control sheet.
  const openSourceControl = () => (extensions.some((e) => e.id === 'git-pro') ? setPanel(GIT_PRO_PANEL) : setSourceControl(true));

  useEffect(() => {
    // A snapshot on opening, at most hourly; after a moment, so the editor opens first.
    const timer = setTimeout(() => snapshots.maybeTake(project).catch((e) => console.warn('Snapshot failed', e)), SNAPSHOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    projectsStore.getState().loadTree(project);
    tabsStore.getState().setLastProject(project);
    // Leaving the screen means the list is home again on the next launch.
    return () => tabsStore.getState().setLastProject(null);
  }, [project]);

  useEffect(() => {
    Animated.timing(progress, { toValue: drawerOpen ? 1 : 0, duration: reduceMotion ? 0 : 200, useNativeDriver: true }).start();
  }, [drawerOpen, progress, reduceMotion]);

  const openFile = (path: string) => {
    if (rightFocused) {
      tabsStore.getState().openTab(project, path, false);
      setSplit({ path });
    } else tabsStore.getState().openTab(project, path);
    setDrawerOpen(false);
  };

  // Wraps around, like Ctrl-Tab in most editors.
  function switchTab(step: number) {
    if (!tabs.open.length) return;
    const i = current ? tabs.open.indexOf(current) : -1;
    openFile(tabs.open[(i + step + tabs.open.length) % tabs.open.length]);
  }

  async function closeFile(path: string) {
    await buffersStore.getState().save(project, path);
    const rest = tabs.open.filter((p) => p !== path);
    // The right pane moves to a neighbour too.
    if (split?.path === path) setSplit({ path: rest[Math.min(tabs.open.indexOf(path), rest.length - 1)] ?? null });
    tabsStore.getState().closeTab(project, path);
  }

  function toggleSplit() {
    if (!wide) return;
    if (splitOn) {
      setSplit(null);
      setFocusedPane('left');
    } else {
      // Start with the same file, the way most editors split.
      setSplit({ path: tabs.active });
      setFocusedPane('right');
    }
  }

  async function runProject(config = selectedConfig) {
    if (!config) {
      Alert.alert('Nothing to run', projectTasks.error ?? 'Add a tide.json with "runtime" and "entry" to say how to run this project.');
      return;
    }
    const line = configLine(config, runnerStore.getState().mode);
    haptic('press');
    countRun();
    await buffersStore.getState().flushProject(project);
    setTerminalHidden(false);
    terminal.current?.input(line);
  }

  const openAt = (path: string, line: number, column?: number) => {
    openFile(path);
    editor.current?.reveal(path, line, column);
  };

  const save = (path: string) => saveWithHooks(extensions, ctx, path);

  const projectTasks = useProjectTasks(project);
  const chosenConfig = useRunner((s) => s.configs[project] ?? DEFAULT_CONFIG);
  const selectedConfig: NamedConfig | undefined = projectTasks.configs.find((c) => c.name === chosenConfig) ?? projectTasks.configs[0];

  const latestRun = useRef(() => runProject());
  latestRun.current = () => runProject();

  async function runTask(task: Task) {
    const line = taskLine(task, runnerStore.getState().mode);
    if (!line) return;
    haptic('press');
    await buffersStore.getState().flushProject(project);
    setTerminalHidden(false);
    if (task.newTerminal) {
      terminal.current?.newTerminal();
      // The new terminal needs a moment before it takes input.
      setTimeout(() => terminal.current?.input(`${line}\r`), NEW_TERMINAL_DELAY_MS);
    } else terminal.current?.input(`${line}\r`);
  }

  // A link can open a file (at a line) and run the project. The terminal
  // needs a moment after mounting before it takes input.
  useEffect(() => {
    if (!launch) return;
    if (launch.file) {
      if (launch.line) openAt(launch.file, launch.line);
      else openFile(launch.file);
    }
    if (!launch.run) return;
    // Through a ref: by then tide.json has been read, which this render hadn't.
    const timer = setTimeout(() => latestRun.current().catch((e) => console.warn('Run failed', e)), LAUNCH_RUN_DELAY_MS);
    return () => clearTimeout(timer);
    // Once per opening; the screen is keyed by project.
  }, []);

  const copyLink = (options?: ProjectLinkOptions) => Clipboard.setStringAsync(projectLink(project, options));

  // Palette pull and push; failures open the sheet, which can re-grant access.
  const syncFolder = (sync: (project: string) => Promise<unknown>) =>
    sync(project).catch((e: Error) =>
      Alert.alert("Couldn't sync the folder", e.message, [
        { text: 'OK', style: 'cancel' },
        { text: 'Open linked folder', onPress: () => setShowLinked(true) },
      ]),
    );

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
    { id: 'goto-line', title: 'Go to line', icon: 'corner-down-right', hint: '⌘L', run: () => current && setGoingToLine(true) },
    { id: 'save', title: 'Save file', icon: 'save', hint: '⌘S', run: () => current && save(current).then(() => haptic('success')) },
    { id: 'close-tab', title: 'Close file', icon: 'x', hint: '⌘W', run: () => current && closeFile(current) },
    ...(wide ? [{ id: 'split', title: splitOn ? 'Close the second editor' : 'Split editor', icon: 'columns' as const, hint: '⌘\\', run: toggleSplit }] : []),
    ...(current && previewKind(current)
      ? [{ id: 'preview', title: previewing(current) ? 'Show source' : 'Show preview', icon: 'eye' as const, hint: '⇧⌘V', run: togglePreview }]
      : []),
    ...(current
      ? [
          ...(currentHasConflicts
            ? [{ id: 'compare.merge', title: 'Resolve conflicts in the merge editor', icon: 'git-merge' as const, run: () => setCompare({ path: current, with: 'merge' }) }]
            : []),
          ...(dirty.has(current)
            ? [{ id: 'compare.saved', title: 'Compare with saved', icon: 'file-text' as const, run: () => setCompare({ path: current, with: 'saved' }) }]
            : []),
          { id: 'compare.head', title: 'Compare with last commit', icon: 'git-commit' as const, run: () => setCompare({ path: current, with: 'head' }) },
          {
            id: 'compare.file',
            title: 'Compare with file…',
            icon: 'copy' as const,
            run: () => {
              comparingWith.current = current;
              setPalette('files');
            },
          },
        ]
      : []),
    { id: 'undo', title: 'Undo', icon: 'rotate-ccw', run: () => editor.current?.send({ type: 'undo' }) },
    { id: 'redo', title: 'Redo', icon: 'rotate-cw', run: () => editor.current?.send({ type: 'redo' }) },
    { id: 'files', title: 'Show or hide files', icon: 'sidebar', hint: '⌘B', run: () => (wide ? setSidebarHidden((h) => !h) : setDrawerOpen((o) => !o)) },
    { id: 'next-tab', title: 'Next file', icon: 'chevron-right', hint: '⇧⌘]', run: () => switchTab(1) },
    { id: 'prev-tab', title: 'Previous file', icon: 'chevron-left', hint: '⇧⌘[', run: () => switchTab(-1) },
    {
      id: 'run',
      title: selectedConfig && projectTasks.configs.length > 1 ? `Run project (${selectedConfig.name})` : 'Run project',
      icon: 'play',
      hint: '⌘R',
      run: () => runProject(),
    },
    ...projectTasks.configs.map((c) => ({
      id: `run-config:${c.name}`,
      title: `Run configuration: ${c.name}`,
      icon: 'play-circle' as const,
      // Picking one also makes it what ⌘R runs.
      run: () => {
        runnerStore.getState().setConfig(project, c.name);
        runProject(c);
      },
    })),
    ...projectTasks.tasks.map((t) => ({ id: `task:${t.name}`, title: `Task: ${t.name}`, icon: 'zap' as const, run: () => runTask(t) })),
    {
      id: 'new-terminal',
      title: 'New terminal',
      icon: 'plus-square',
      hint: '⌘T',
      run: () => {
        setTerminalHidden(false);
        terminal.current?.newTerminal();
      },
    },
    { id: 'terminal.close', title: 'Close terminal', icon: 'x-square', run: () => terminal.current?.closeTerminal() },
    { id: 'terminal.next', title: 'Next terminal', icon: 'terminal', run: () => terminal.current?.nextTerminal() },
    { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', icon: 'command', hint: '⇧⌘?', run: () => setShortcutsOpen(true) },
    { id: 'toggle-terminal', title: 'Toggle terminal', icon: 'terminal', hint: '⌘J', run: () => setTerminalHidden((h) => !h) },
    { id: 'local', title: 'Terminal: use Local', icon: 'smartphone', run: () => runnerStore.getState().setMode('local') },
    { id: 'remote', title: 'Terminal: use Remote', icon: 'server', run: () => runnerStore.getState().setMode('remote') },
    { id: 'tests', title: 'Run tests', icon: 'check-square', run: () => setTests({}) },
    ...(current && (isJsTestFile(current) || isPyTestFile(current))
      ? [{ id: 'tests.file', title: 'Run tests in this file', icon: 'check-square' as const, run: () => setTests({ files: [current], language: isPyTestFile(current) ? 'python' : 'js' }) }]
      : []),
    { id: 'packages', title: 'Packages (npm, pip)', icon: 'box', run: () => setPackagesOpen(true) },
    { id: 'source-control', title: 'Source control', icon: 'git-branch', run: openSourceControl },
    { id: 'settings', title: 'Settings', icon: 'settings', hint: '⌘,', run: () => router.push('/settings') },
    { id: 'extensions', title: 'Extensions', icon: 'package', run: () => router.push('/extensions') },
    {
      id: 'export',
      title: 'Export project as .zip',
      icon: 'share',
      run: () =>
        buffersStore
          .getState()
          .flushProject(project)
          .then(() => exportProject(project))
          .catch((e: Error) => Alert.alert("Couldn't export", e.message)),
    },
    {
      id: 'share-file',
      title: 'Share file',
      icon: 'share',
      run: () => current && shareFile(project, current).catch((e: Error) => Alert.alert("Couldn't share", e.message)),
    },
    { id: 'copy-link', title: 'Copy link to this project', icon: 'link', run: () => copyLink() },
    { id: 'copy-run-link', title: 'Copy link that runs this project', icon: 'link', run: () => copyLink({ run: true }) },
    ...(current ? [{ id: 'copy-file-link', title: 'Copy link to this file', icon: 'link' as const, run: () => copyLink({ file: current }) }] : []),
    { id: 'snapshots', title: 'Snapshots', icon: 'clock', run: () => setShowSnapshots(true) },
    { id: 'linked-folder', title: linked ? `Linked folder: ${linked}` : 'Link to a folder in Files', icon: 'folder', run: () => setShowLinked(true) },
    ...(linked
      ? [
          { id: 'folder.pull', title: `Pull from ${linked}`, icon: 'download' as const, run: () => syncFolder(pullFolder) },
          { id: 'folder.push', title: `Push to ${linked}`, icon: 'upload' as const, run: () => syncFolder(pushFolder) },
        ]
      : []),
    ...extensions.flatMap((ext) => ext.commands?.(ctx) ?? []),
  ]);
  const panels = uniqueById(extensions.flatMap((ext) => ext.panels ?? []));

  // Hardware keyboard shortcuts arrive from whichever WebView has focus.
  const onShortcut = (id: Shortcut) => {
    const tab = /^tab-(\d)$/.exec(id);
    if (id === 'palette') setPalette('commands');
    else if (tab) {
      const path = tabs.open[Number(tab[1]) - 1];
      if (path) openFile(path);
    } else commands.find((c) => c.id === id)?.run();
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Projects" onPress={() => router.back()} testID="back" />
        {!wide && <IconButton icon="sidebar" label="Files" onPress={() => setDrawerOpen(true)} testID="open-tree" />}
        <Text variant="title" numberOfLines={1} style={styles.title}>
          {project}
        </Text>
        {current && previewKind(current) && (
          <IconButton
            icon={previewing(current) ? 'code' : 'eye'}
            label={previewing(current) ? 'Show source' : 'Show preview'}
            onPress={togglePreview}
            testID="toggle-preview"
          />
        )}
        <IconButton icon="git-branch" label="Source control" onPress={openSourceControl} testID="open-source-control" />
        <IconButton icon="search" label="Search in project" onPress={() => setSearching(true)} testID="open-search" />
        <IconButton icon="command" label="Commands" onPress={() => setPalette('commands')} testID="open-palette" />
      </View>

      <View style={[styles.body, wide && styles.row]}>
        {wide && !sidebarHidden && (
          <View style={[styles.sidebar, { paddingBottom: insets.bottom }]} testID="sidebar">
            <FileTree project={project} nodes={tree ?? []} activePath={current} onOpenFile={openFile} />
          </View>
        )}
        <View style={styles.body}>
          <TabBar open={tabs.open} active={current} onSelect={openFile} dirty={dirty} onClose={(path) => closeFile(path)} />

          {extensions.map((ext) => ext.bar && <ext.bar key={ext.id} ctx={ctx} />)}
          {/* Both panes stay mounted so the terminal keeps its scrollback and the editor its undo history. */}
          <View
            style={[styles.editor, splitOn && styles.row, keyboardOpen && typingIn === 'terminal' && !terminalHidden && styles.collapsed]}
            onLayout={(e) => setEditorWidth(e.nativeEvent.layout.width)}
          >
            <View style={[styles.pane, splitOn && { flex: splitRatio }, splitOn && !rightFocused && styles.focusedPane]}>
              <EditorPane
                ref={leftEditor}
                project={project}
                path={tabs.active}
                features={features}
                host={editorHost}
                onBrowse={() => (wide ? setPalette('files') : setDrawerOpen(true))}
                onFocusChange={(focused) => {
                  if (!focused) return;
                  setTypingIn('editor');
                  setFocusedPane('left');
                }}
                onShortcut={onShortcut}
              />
              {previewing(tabs.active) && <PreviewPane project={project} path={tabs.active!} />}
            </View>
            {splitOn && (
              <>
                <SplitDivider ratio={splitRatio} width={editorWidth} onChange={setSplitRatio} />
                <View style={[styles.pane, { flex: 1 - splitRatio }, rightFocused && styles.focusedPane]} testID="right-editor">
                  <EditorPane
                    ref={rightEditor}
                    project={project}
                    path={split.path}
                    features={features}
                    host={editorHost}
                    onBrowse={() => {
                      setFocusedPane('right');
                      setPalette('files');
                    }}
                    onFocusChange={(focused) => {
                      if (!focused) return;
                      setTypingIn('editor');
                      setFocusedPane('right');
                    }}
                    onShortcut={onShortcut}
                  />
                  {previewing(split.path) && <PreviewPane project={project} path={split.path!} />}
                </View>
              </>
            )}
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
            <EditorKeyBar send={(msg) => editor.current?.send(msg)} language={languageFor(current ?? '')} />
          )}
        </View>
      )}

      {!wide && (
        <>
          <Animated.View
            pointerEvents={drawerOpen ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) }]}
          >
            <Pressable accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} accessibilityLabel="Close files" />
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
            <FileTree project={project} nodes={tree ?? []} activePath={current} onOpenFile={openFile} />
          </Animated.View>
        </>
      )}

      <CommandPalette
        mode={palette}
        project={project}
        commands={commands}
        onOpenFile={(path) => {
          const base = comparingWith.current;
          comparingWith.current = null;
          if (base && base !== path) setCompare({ path: base, with: { file: path } });
          else openFile(path);
        }}
        onClose={() => {
          // The palette closes just before it reports the pick, so the reset
          // waits a tick: it only matters when it closed without one.
          setTimeout(() => (comparingWith.current = null), 0);
          setPalette(null);
        }}
      />
      <CompareView project={project} request={compare} onClose={() => setCompare(null)} />
      <TestsSheet
        project={project}
        request={tests}
        onClose={() => setTests(null)}
        onOpen={(path, line) => (line ? openAt(path, line) : openFile(path))}
        onTerminal={(line) => {
          setTerminalHidden(false);
          terminal.current?.input(`${line}\r`);
        }}
      />
      <PackagesSheet
        project={project}
        visible={packagesOpen}
        onClose={() => setPackagesOpen(false)}
        onTerminal={(line) => {
          setTerminalHidden(false);
          terminal.current?.input(`${line}\r`);
        }}
      />
      <SourceControlSheet visible={sourceControl} project={project} onClose={() => setSourceControl(false)} />
      {panels.map(({ id, component: Panel }) => (
        <Panel key={id} ctx={ctx} visible={panel === id} onClose={() => setPanel((p) => (p === id ? null : p))} />
      ))}
      <SearchPanel visible={searching} project={project} onOpen={openAt} onClose={() => setSearching(false)} />
      <ShortcutsSheet visible={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SnapshotsSheet project={showSnapshots ? project : null} onClose={() => setShowSnapshots(false)} />
      <LinkedFolderSheet project={showLinked ? project : null} onClose={() => setShowLinked(false)} />
      <PromptSheet
        visible={goingToLine}
        title="Go to line"
        placeholder="Line number"
        confirmLabel="Go"
        keyboardType="number-pad"
        onSubmit={async (value) => {
          const line = Number.parseInt(value, 10);
          if (!Number.isFinite(line) || line < 1) throw new Error('Enter a line number');
          if (current) editor.current?.reveal(current, line);
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
  pane: { flex: 1 },
  // A thin line marks which editor gets the key bar and commands.
  focusedPane: { borderTopWidth: 2, borderColor: colors.brand },
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
