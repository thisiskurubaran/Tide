import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Alert, Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { ActionSheet } from '../../components/ActionSheet';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { answerRequest, editorFeatures, findDefinition, saveWithHooks, useActiveExtensions, useExtensionHost } from '../../extensions/host';
import { GIT_PRO_PANEL } from '../../extensions/gitPro';
import type { ProjectContext } from '../../extensions/types';
import { buffersStore, projectsStore, runnerStore, snapshots, tabsStore, useBuffers, useProjects, useRunner, useTabs, workspace } from '../../state';
import { bufferKey, isDirty } from '../../state/buffers';
import { isPinned, othersToClose, projectTabs } from '../../state/tabs';
import { borderWidth, fonts, radius, spacing } from '../../theme/tokens';
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
import { editorCommands } from '../editor/editorCommands';
import { SearchPanel } from '../search/SearchPanel';
import { TodosPanel } from '../todos/TodosPanel';
import { OutlinePanel } from '../outline/OutlinePanel';
import { NotebookBar } from '../notebook/NotebookBar';
import { AiMode, AiSheet } from '../ai/AiSheet';
import { launchConfirmation, projectLink, ProjectLinkOptions } from '../launch/links';
import { configLine, DEFAULT_CONFIG, NamedConfig, taskLine, Task } from './tasks';
import { useProjectTasks } from './useProjectTasks';
import type { Shortcut } from './shortcuts';
import { ShortcutsSheet } from './ShortcutsSheet';
import { SplitDivider } from './SplitDivider';
import { TabBar } from './TabBar';
import { TerminalPanel, TerminalPanelHandle } from './TerminalPanel';
import { TerminalGrabber, DETENTS } from './TerminalGrabber';
import { StatusBar, countProblems } from './StatusBar';
import { Activity, ActivityBar, ActivityItem } from './ActivityBar';
import { TideWave } from '../../components/TideWave';
import { EditorTour, resetEditorTour, useTourTarget } from '../onboarding/tour';
import { runActivity } from '../widgets/runActivity';
import { openAgent } from '../agent';
import { gitStatusStore, useGitStatus } from '../git/status';
import { useDiagnostics } from '../../extensions/diagnostics';
import { recentsStore } from '../../state/recents';
import { makeStyles, useColors } from '../../theme/theme';
import { haptic } from '../../components/haptics';
import { countRun } from '../support/actions';
import { PreviewPane } from '../preview/PreviewPane';
import { previewKind, viewerFirst, viewerOnly } from '../preview/render';
import { projectFileFor } from '../terminal/fileRefs';
import { ProblemsPanel } from '../problems/ProblemsPanel';
import { FixSheet, type FixRequest } from '../problems/FixSheet';
import { Breadcrumbs, cursorStore } from '../outline/Breadcrumbs';
import { SuggestionBanner } from '../../extensions/suggest/SuggestionBanner';
import { matchOutput } from '../problems/matchers';
import { wordAt } from '../docs/docs';
import { DatabasePane } from '../database/DatabasePane';
import { HttpPane } from '../http/HttpPane';
import { OpenApiPane } from '../openapi/OpenApiPane';
import { HTTP_TEMPLATE } from '../http/http';
import { requestSend } from '../http/pending';
import { autoDeployer, deployStore } from '../deploy';
import { useDeployStatus } from '../deploy/auto';
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
// A swipe this far in from the left edge opens the files on phones.
const EDGE_WIDTH = 16;
const EDGE_OPEN_DX = 40;

// `launch` comes from a tide:// link or quick action: a file to open, and whether to run.
export function ProjectScreen({ project, launch }: { project: string; launch?: ProjectLinkOptions | null }) {
  const styles = useStyles();
  const colors = useColors();
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
  const [todos, setTodos] = useState(false);
  const [outline, setOutline] = useState(false);
  const [ai, setAi] = useState<AiMode | null>(null);
  const [goingToLine, setGoingToLine] = useState(false);
  // Closed until something runs or it's asked for, so the editor gets the screen.
  const [terminalHidden, setTerminalHidden] = useState(true);
  const [terminalSize, setTerminalSize] = useState(DETENTS[0] + 0.1);
  const [running, setRunning] = useState(false);
  const [mainHeight, setMainHeight] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [liveWindow, setLiveWindow] = useState(false);
  // Two-finger tap in the editor: actions for the word at the cursor.
  const [editorActions, setEditorActions] = useState(false);
  // An inline AI suggestion is showing, so the key bar offers Accept.
  const [ghost, setGhost] = useState(false);
  // A problem being fixed with AI, from the error lens or the Problems panel.
  const [fixRequest, setFixRequest] = useState<FixRequest | null>(null);
  const [sidebarRatio, setSidebarRatio] = useState(0);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [previewRatio, setPreviewRatio] = useState(0.5);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sourceControl, setSourceControl] = useState(false);
  const [panel, setPanel] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showLinked, setShowLinked] = useState(false);
  // A file the tree should open its folders to, scroll to and highlight.
  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);
  const reduceMotion = useReduceMotion();
  const [compare, setCompare] = useState<CompareRequest | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [problems, setProblems] = useState(false);
  // The terminal output the AI sheet's Error tab explains, and the file it points at.
  const [aiError, setAiError] = useState<{ output: string; path: string | null } | null>(null);
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [tests, setTests] = useState<TestsRequest | null>(null);
  // "Compare with file…" uses the file picker; the next pick is the other file.
  const comparingWith = useRef<string | null>(null);
  const currentHasConflicts = useBuffers((s) => (current ? hasConflicts(s.buffers[bufferKey(project, current)]?.content ?? '') : false));
  // Files shown rendered instead of as source. Notebooks and .http files start
  // out in their viewer; databases only have one.
  const [previewToggled, setPreviewToggled] = useState<Record<string, boolean>>({});
  const previewing = (path: string | null) =>
    !!path && !!previewKind(path) && (viewerOnly(previewKind(path)) || (previewToggled[path] ?? viewerFirst(previewKind(path))));
  const canToggle = (path: string | null) => !!path && !!previewKind(path) && !viewerOnly(previewKind(path));
  const togglePreview = () => canToggle(current) && setPreviewToggled((t) => ({ ...t, [current!]: !previewing(current) }));
  const viewer = (path: string | null) =>
    previewing(path) &&
    (previewKind(path!) === 'sqlite' ? (
      <DatabasePane project={project} path={path!} />
    ) : previewKind(path!) === 'http' ? (
      <HttpPane project={project} path={path!} />
    ) : previewKind(path!) === 'openapi' ? (
      <OpenApiPane project={project} path={path!} />
    ) : previewKind(path!) === 'html' ? (
      (() => {
        // Loaded on first use, like the other viewers that pull in native modules.
        const { HtmlFilePreview } = require('../preview/HtmlFilePreview') as typeof import('../preview/HtmlFilePreview');
        return <HtmlFilePreview project={project} path={path!} />;
      })()
    ) : previewKind(path!) === 'table' || previewKind(path!) === 'parquet' ? (
      (() => {
        // Loaded on first use: Parquet support pulls in hyparquet.
        const { DataPane } = require('../data/DataPane') as typeof import('../data/DataPane');
        return <DataPane project={project} path={path!} />;
      })()
    ) : previewKind(path!) === 'notebook' ? (
      // Notebooks get a bar to run their Python cells.
      <View style={StyleSheet.absoluteFill}>
        <NotebookBar project={project} path={path!} />
        <View style={styles.flexFill}>
          <PreviewPane project={project} path={path!} />
        </View>
      </View>
    ) : (
      <PreviewPane project={project} path={path!} />
    ));
  const linked = useLinked((s) => s.links[project]?.name);
  const progress = useRef(new Animated.Value(0)).current;
  const activePath = useRef(current);
  activePath.current = current;
  const cursor = useRef<{ path: string; offset: number } | null>(null);
  const extensions = useActiveExtensions();
  const features = useMemo(() => editorFeatures(extensions), [extensions]);
  // Git Tools's screen stands in for the Source Control sheet.
  const openSourceControl = () => (extensions.some((e) => e.id === 'git-pro') ? setPanel(GIT_PRO_PANEL) : setSourceControl(true));

  useEffect(() => {
    // A snapshot on opening, at most hourly; after a moment, so the editor opens first.
    const timer = setTimeout(() => snapshots.maybeTake(project).catch((e) => console.warn('Snapshot failed', e)), SNAPSHOT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project]);

  const git = useGitStatus((s) => s.byProject[project]);
  const changedCount = git ? Object.keys(git.changes).length : 0;
  const problemsByPath = useDiagnostics((s) => s.byProject[project]);
  const problemCount = useMemo(() => {
    const { errors, warnings } = countProblems(problemsByPath);
    return errors + warnings;
  }, [problemsByPath]);

  useEffect(() => {
    recentsStore.getState().touchProject(project);
    gitStatusStore.getState().refresh(project).catch(() => undefined);
  }, [project]);

  useEffect(() => {
    projectsStore.getState().loadTree(project);
    tabsStore.getState().setLastProject(project);
    // Leaving the screen means the list is home again on the next launch.
    return () => tabsStore.getState().setLastProject(null);
  }, [project]);

  useEffect(() => {
    // A spring that follows through like a native drawer; Reduce Motion snaps.
    if (reduceMotion) progress.setValue(drawerOpen ? 1 : 0);
    else Animated.spring(progress, { toValue: drawerOpen ? 1 : 0, damping: 26, stiffness: 260, mass: 0.9, useNativeDriver: true }).start();
  }, [drawerOpen, progress, reduceMotion]);

  const openFile = (path: string) => {
    if (rightFocused) {
      tabsStore.getState().openTab(project, path, false);
      setSplit({ path });
    } else tabsStore.getState().openTab(project, path);
    setDrawerOpen(false);
  };

  // requests.http, or requests-2.http and so on when that's taken, started from an example.
  const newHttpFile = async () => {
    for (let n = 1; ; n++) {
      const name = n === 1 ? 'requests.http' : `requests-${n}.http`;
      if ((await workspace.fileSize(project, name).catch(() => null)) !== null) continue;
      const path = await workspace.createFile(project, '', name, HTTP_TEMPLATE);
      await projectsStore.getState().loadTree(project);
      openFile(path);
      return;
    }
  };

  // Wraps around, like Ctrl-Tab in most editors.
  function switchTab(step: number) {
    if (!tabs.open.length) return;
    const i = current ? tabs.open.indexOf(current) : -1;
    openFile(tabs.open[(i + step + tabs.open.length) % tabs.open.length]);
  }

  // The editors send typing on a short debounce: get their last keystrokes
  // into the buffers before saving, closing or running.
  const flushEditorPanes = () => Promise.all([leftEditor.current?.flush(), rightEditor.current?.flush()]);

  // A file deleted on disk with unsaved edits: what to do with them on close.
  const askDeletedClose = (path: string) =>
    new Promise<'save' | 'discard' | 'cancel'>((resolve) =>
      Alert.alert(
        `${path.split('/').pop()} was deleted`,
        'It has unsaved changes that are only kept in this tab.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
          { text: "Don't save", style: 'destructive', onPress: () => resolve('discard') },
          { text: 'Save as new file', onPress: () => resolve('save') },
        ],
        { cancelable: true, onDismiss: () => resolve('cancel') },
      ),
    );

  async function closeFile(path: string) {
    // The tab's X is native, so the editor may still hold the last keystrokes.
    await flushEditorPanes();
    try {
      await buffersStore.getState().save(project, path);
    } catch (e) {
      Alert.alert("Couldn't save", `${path} wasn't saved, so its tab stays open. ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const buffer = buffersStore.getState().buffers[bufferKey(project, path)];
    if (buffer?.deleted && isDirty(buffer)) {
      const choice = await askDeletedClose(path);
      if (choice === 'cancel') return;
      if (choice === 'discard') buffersStore.getState().discard(project, path);
      else {
        try {
          await buffersStore.getState().save(project, path, { recreate: true });
          await projectsStore.getState().loadTree(project);
        } catch (e) {
          Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
          return;
        }
      }
    }
    // Read now, not from the render: tabs may have changed during the awaits.
    const open = projectTabs(tabsStore.getState(), project).open;
    const rest = open.filter((p) => p !== path);
    // The right pane moves to a neighbour too.
    setSplit((s) => (s?.path === path ? { path: rest[Math.min(open.indexOf(path), rest.length - 1)] ?? null } : s));
    tabsStore.getState().closeTab(project, path);
    // Reopening reads the file fresh, so changes made on disk meanwhile show up.
    buffersStore.getState().drop(project, path);
  }

  // The right pane's file went away without closeFile (deleted on disk or in
  // the tree, renamed, moved): it follows a rename, or moves to a neighbour.
  const previousOpen = useRef(tabs.open);
  useEffect(() => {
    const before = previousOpen.current;
    previousOpen.current = tabs.open;
    if (!split?.path || tabs.open.includes(split.path)) return;
    const i = before.indexOf(split.path);
    const renamed = i !== -1 && before.length === tabs.open.length && !before.includes(tabs.open[i]) ? tabs.open[i] : undefined;
    setSplit({ path: renamed ?? tabs.open[Math.min(Math.max(i, 0), tabs.open.length - 1)] ?? null });
  }, [tabs.open, split]);

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

  // What the Live Activity calls a run: tests, a server, or another task.
  const runKind = (line: string): 'tests' | 'server' | 'task' =>
    /\b(test|jest|vitest|pytest|mocha)\b/.test(line) ? 'tests' : /\b(dev|start|serve|server)\b|vite|next|http\.server|flask|uvicorn/.test(line) ? 'server' : 'task';
  const startActivity = (line: string) => runActivity.onRunStart(project, line.trim(), runKind(line));

  async function runProject(config = selectedConfig) {
    if (!config) {
      Alert.alert('Nothing to run', projectTasks.error ?? 'Add a tide.json with "runtime" and "entry" to say how to run this project.');
      return;
    }
    const line = configLine(config, runnerStore.getState().mode);
    haptic('press');
    countRun();
    await flushEditorPanes();
    await buffersStore.getState().flushProject(project);
    setTerminalHidden(false);
    startActivity(line);
    terminal.current?.input(line);
  }

  // The word at the cursor (e.g. "map" in arr.map), searched in offline docs.
  const lookUpInDocs = () => {
    const at = cursor.current;
    const text = at ? buffersStore.getState().buffers[bufferKey(project, at.path)]?.content : undefined;
    const q = at && text !== undefined ? wordAt(text, at.offset) : '';
    router.push(q ? { pathname: '/docs', params: { q } } : '/docs');
  };

  // The last error in the active terminal, explained by the AI assistant with
  // the file it points at (or the open file).
  const explainLastError = async () => {
    const output = terminal.current?.recentOutput() ?? '';
    const found = matchOutput(output);
    if (!found.length && !/error|exception|traceback|failed/i.test(output)) {
      Alert.alert('No error to explain', 'Run your code in the terminal first. When it fails, this explains the error and suggests a fix.');
      return;
    }
    const files = await workspace.listFiles(project).catch(() => [] as string[]);
    const last = found[found.length - 1];
    setAiError({ output, path: (last && projectFileFor(last.path, project, files)) ?? current ?? null });
    setAi('error');
  };

  // A path:line tapped in the terminal, as the program printed it.
  const openPrinted = async (printed: string, line: number, column?: number) => {
    const files = await workspace.listFiles(project).catch(() => [] as string[]);
    const path = projectFileFor(printed, project, files);
    if (path) openAt(path, line, column);
    else Alert.alert("Couldn't find that file", `${printed} isn't in this project.`);
  };
  const openAt = (path: string, line: number, column?: number) => {
    openFile(path);
    editor.current?.reveal(path, line, column);
  };

  const save = (path: string) =>
    saveWithHooks(extensions, ctx, path).then(() => {
      autoDeployer.onSave(project).catch(() => undefined);
      gitStatusStore.getState().refresh(project).catch(() => undefined);
    });

  // Run turns into Stop while the terminal is busy; Stop sends Ctrl-C.
  const stopRunning = () => {
    haptic('press');
    terminal.current?.input('\x03');
  };
  const showFiles = () => (wide ? setSidebarHidden((h) => !h) : setDrawerOpen((o) => !o));
  // Shows the files (sidebar or drawer) with the file found and highlighted.
  const revealInTree = (path: string | null) => {
    if (!path) return;
    if (wide) setSidebarHidden(false);
    else setDrawerOpen(true);
    setReveal((r) => ({ path, nonce: (r?.nonce ?? 0) + 1 }));
  };

  // ⇧⌘T: the last closed tab whose file is still there, back where it was.
  const reopenClosedTab = async () => {
    const exists = async (path: string) => (await workspace.stat(project, path).catch(() => null)) === 'file';
    const path = await tabsStore.getState().reopenClosedTab(project, exists, !rightFocused);
    if (path && rightFocused) setSplit({ path });
    else if (!path) haptic('warning');
  };
  // Pinned tabs stay; each other tab closes as ⌘W would, saving first.
  const closeTabs = async (paths: string[]) => {
    for (const path of paths) await closeFile(path);
  };
  const closeOtherTabs = (keep: string | null) => closeTabs(othersToClose(projectTabs(tabsStore.getState(), project), keep));
  const deployStatus = useDeployStatus(deployStore, project);
  // A finished deploy's note goes away after a moment; failures stay until tapped.
  useEffect(() => {
    if (deployStatus?.state !== 'done') return;
    const t = setTimeout(() => deployStore.getState().setStatus(project, undefined), 6000);
    return () => clearTimeout(t);
  }, [deployStatus, project]);

  const projectTasks = useProjectTasks(project);
  const chosenConfig = useRunner((s) => s.configs[project] ?? DEFAULT_CONFIG);
  const selectedConfig: NamedConfig | undefined = projectTasks.configs.find((c) => c.name === chosenConfig) ?? projectTasks.configs[0];

  const latestRun = useRef(() => runProject());
  latestRun.current = () => runProject();

  async function runTask(task: Task) {
    const line = taskLine(task, runnerStore.getState().mode);
    if (!line) return;
    haptic('press');
    await flushEditorPanes();
    await buffersStore.getState().flushProject(project);
    setTerminalHidden(false);
    startActivity(line);
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
    // From the Live Activity's Stop.
    if (launch.stop) terminal.current?.input('\x03');
    // From the Lock Screen and Last run widgets: the last run's output.
    if (launch.output) setTerminalHidden(false);
    // Sending, running and testing come from Shortcuts and widgets, but any
    // app or page can open the link: they wait for a yes.
    const ask = launchConfirmation(project, launch);
    if (!ask) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const go = () => {
      if (!alive) return;
      if (launch.file && launch.send) requestSend(project, launch.file, launch.send);
      if (launch.tests) setTests({});
      // Through a ref: by then tide.json has been read, which this render hadn't.
      if (launch.run) timer = setTimeout(() => latestRun.current().catch((e) => console.warn('Run failed', e)), LAUNCH_RUN_DELAY_MS);
    };
    Alert.alert(ask.title, ask.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ask.action, onPress: go },
    ]);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
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
    // A few lines around the definition, shown inline under the cursor line.
    async peek(path, offset) {
      const [target] = await findDefinition(extensions, project, path, offset);
      if (!target) return null;
      const buffered = buffersStore.getState().buffers[bufferKey(project, target.path)]?.content;
      const content = buffered ?? (await workspace.readFile(project, target.path).catch(() => null));
      if (content === null) return null;
      const lines = content.split('\n');
      const startLine = Math.max(1, target.line - 2);
      return { path: target.path, line: target.line, startLine, text: lines.slice(startLine - 1, startLine - 1 + 12).join('\n') };
    },
    openAt: (path, line) => openAt(path, line),
    cursor: (path, offset) => {
      cursor.current = { path, offset };
      cursorStore.setState({ path, offset });
    },
    save: (path) => {
      save(path).catch((e) => console.warn('Save failed', e));
    },
  };

  const commands = uniqueById<Command>([
    { id: 'quick-open', title: 'Open file', icon: 'file', hint: '⌘P', run: () => setPalette('files') },
    { id: 'search', title: 'Search in project', icon: 'search', hint: '⇧⌘F', run: () => setSearching(true) },
    { id: 'todos', title: 'TODOs in project', icon: 'check-square', run: () => setTodos(true) },
    { id: 'symbols', title: 'Go to symbol (outline)', icon: 'list', hint: '⇧⌘O', run: () => setOutline(true) },
    ...(current
      ? (['explain', 'fix', 'ask'] as const).map((m) => ({
          id: `ai.${m}`,
          title: m === 'explain' ? 'AI: explain this file' : m === 'fix' ? 'AI: fix bugs in this file' : 'AI: ask about this file…',
          icon: 'cpu' as const,
          run: () => setAi(m),
        }))
      : []),
    { id: 'github', title: 'GitHub', icon: 'github', run: () => router.push('/github') },
    { id: 'deploy', title: 'Deploy…', icon: 'upload-cloud', run: () => router.push({ pathname: '/deploy', params: { project } }) },
    { id: 'env', title: 'Environment variables…', icon: 'key', run: () => router.push({ pathname: '/env', params: { project } }) },
    { id: 'databases', title: 'Databases…', icon: 'database', run: () => router.push('/databases') },
    { id: 'tools', title: 'Developer tools (JSON, regex, Base64, JWT…)', icon: 'tool', run: () => router.push('/tools') },
    { id: 'docs', title: 'Look up in docs (offline)', icon: 'book', hint: '⇧⌘D', run: lookUpInDocs },
    { id: 'ai.error', title: 'Explain the last error with AI', icon: 'cpu', run: () => explainLastError() },
    { id: 'problems', title: 'Show problems', icon: 'alert-triangle', run: () => setProblems(true) },
    { id: 'hosts', title: 'GitLab and Bitbucket…', icon: 'gitlab', run: () => router.push('/hosts') },
    ...(current
      ? [
          { id: 'git.blame', title: 'Git: blame this file', icon: 'user' as const, run: () => router.push({ pathname: '/blame', params: { project, path: current } }) },
          { id: 'git.file-history', title: 'Git: history of this file', icon: 'clock' as const, run: () => router.push({ pathname: '/blame', params: { project, path: current, show: 'history' } }) },
        ]
      : []),
    { id: 'http.new', title: 'New HTTP requests file', icon: 'send', run: () => newHttpFile().catch((e) => Alert.alert('Could not create the file', String(e?.message ?? e))) },
    { id: 'find', title: 'Find in file', icon: 'search', hint: '⌘F', run: () => editor.current?.send({ type: 'find' }) },
    { id: 'goto-line', title: 'Go to line', icon: 'corner-down-right', hint: '⌘L', run: () => current && setGoingToLine(true) },
    { id: 'save', title: 'Save file', icon: 'save', hint: '⌘S', run: () => current && save(current).then(() => haptic('tap')) },
    { id: 'close-tab', title: 'Close file', icon: 'x', hint: '⌘W', run: () => current && closeFile(current) },
    { id: 'reopen-tab', title: 'Reopen closed tab', icon: 'rotate-ccw', hint: '⇧⌘T', run: () => reopenClosedTab() },
    ...(current
      ? [
          isPinned(tabs, current)
            ? { id: 'tab.unpin', title: 'Unpin tab', icon: 'map-pin' as const, run: () => tabsStore.getState().unpinTab(project, current) }
            : { id: 'tab.pin', title: 'Pin tab', icon: 'map-pin' as const, run: () => tabsStore.getState().pinTab(project, current) },
          { id: 'reveal-file', title: 'Reveal in file tree', icon: 'sidebar' as const, run: () => revealInTree(current) },
        ]
      : []),
    ...(othersToClose(tabs, current).length
      ? [{ id: 'close-other-tabs', title: 'Close other tabs', icon: 'x-square' as const, run: () => closeOtherTabs(current) }]
      : []),
    ...(othersToClose(tabs, null).length
      ? [{ id: 'close-all-tabs', title: 'Close all tabs (keeps pinned)', icon: 'x-circle' as const, run: () => closeOtherTabs(null) }]
      : []),
    ...(wide ? [{ id: 'split', title: splitOn ? 'Close the second editor' : 'Split editor', icon: 'columns' as const, hint: '⌘\\', run: toggleSplit }] : []),
    ...(canToggle(current)
      ? [{ id: 'preview', title: previewing(current) ? 'Show source' : 'Show preview', icon: 'eye' as const, hint: '⇧⌘V', run: togglePreview }]
      : []),
    ...(current && (previewKind(current) === 'markdown' || previewKind(current) === 'notebook')
      ? [
          {
            id: 'export-pdf',
            title: 'Export as PDF',
            icon: 'file-text' as const,
            run: () => {
              const { exportPdf } = require('../preview/exportPdf') as typeof import('../preview/exportPdf');
              exportPdf(project, current).catch((e: Error) => Alert.alert('Could not export the PDF', e.message));
            },
          },
        ]
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
          { id: 'history.local', title: 'Local history of this file', icon: 'clock' as const, run: () => setHistoryOf(current) },
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
    { id: 'agent', title: 'Agent: ask for a change across files', icon: 'cpu', run: () => openAgent(project) },
    { id: 'peek', title: 'Peek definition', icon: 'eye', hint: '⌥F12', run: () => editor.current?.send({ type: 'peek' }) },
    { id: 'live-preview', title: liveWindow ? 'Close the live preview window' : 'Live preview window', icon: 'monitor', run: () => setLiveWindow((on) => !on) },
    { id: 'tour', title: 'Show the editor tour again', icon: 'compass', run: () => resetEditorTour() },
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
    // Line commands, Copy selection as Markdown, Share selection as image.
    ...editorCommands(editor, !!current),
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

  const activityItems: ActivityItem[] = [
    { id: 'files', label: 'Files', icon: 'file' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'git', label: 'Git', icon: 'git-branch', badge: changedCount },
    { id: 'terminal', label: 'Terminal', icon: 'terminal' },
    { id: 'problems', label: 'Problems', icon: 'alert-circle', badge: problemCount, alert: true },
    { id: 'more', label: 'More', icon: 'grid' },
  ];
  const activeActivity: Activity | null = (wide ? !sidebarHidden : drawerOpen)
    ? 'files'
    : searching
      ? 'search'
      : sourceControl
        ? 'git'
        : problems
          ? 'problems'
          : moreOpen
            ? 'more'
            : !terminalHidden
              ? 'terminal'
              : null;
  const onActivity = (id: Activity) => {
    haptic('select');
    if (id === 'files') showFiles();
    else if (id === 'search') setSearching(true);
    else if (id === 'git') openSourceControl();
    else if (id === 'terminal') setTerminalHidden((h) => !h);
    else if (id === 'problems') setProblems(true);
    else setMoreOpen(true);
  };
  const run = (id: string) => () => commands.find((c) => c.id === id)?.run();
  const moreActions = [
    { label: 'Agent', icon: 'cpu' as const, onPress: () => openAgent(project) },
    { label: 'All commands', icon: 'command' as const, onPress: () => setPalette('commands') },
    { label: liveWindow ? 'Close live preview' : 'Live preview window', icon: 'monitor' as const, onPress: () => setLiveWindow((on) => !on) },
    { label: 'Go to symbol', icon: 'list' as const, onPress: () => setOutline(true) },
    { label: 'TODOs in project', icon: 'check-square' as const, onPress: () => setTodos(true) },
    { label: 'Run tests', icon: 'check-circle' as const, onPress: () => setTests({}) },
    { label: 'Packages (npm, pip)', icon: 'box' as const, onPress: () => setPackagesOpen(true) },
    { label: 'Deploy…', icon: 'upload-cloud' as const, onPress: run('deploy') },
    { label: 'Look up in docs', icon: 'book' as const, onPress: lookUpInDocs },
    { label: 'Developer tools', icon: 'tool' as const, onPress: run('tools') },
    { label: 'Extensions', icon: 'package' as const, onPress: run('extensions') },
    { label: 'Settings', icon: 'settings' as const, onPress: run('settings') },
  ];

  // A swipe in from the left edge opens the files (the back swipe is off on
  // this screen for that reason; the back button stays). Swiping the drawer
  // left closes it.
  const edgeSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dx > 8 && Math.abs(g.dy) < Math.abs(g.dx),
        onPanResponderRelease: (_e, g) => g.dx > EDGE_OPEN_DX && setDrawerOpen(true),
      }),
    [],
  );
  const drawerSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dx < -12 && Math.abs(g.dy) < Math.abs(g.dx),
        onPanResponderRelease: (_e, g) => g.dx < -EDGE_OPEN_DX && setDrawerOpen(false),
      }),
    [],
  );

  const runTarget = useTourTarget('run');
  const paletteTarget = useTourTarget('palette');
  const filesTarget = useTourTarget('files');
  const terminalTarget = useTourTarget('terminal');
  const tourTargets = { files: filesTarget, terminal: terminalTarget };

  // Opening a project grows the editor in from the card that was tapped.
  const enter = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, damping: 20, stiffness: 220, mass: 0.9, useNativeDriver: true }).start();
  }, [enter]);

  // How the last program ended, shown by the wave for a moment.
  const [runResult, setRunResult] = useState<'success' | 'error' | null>(null);
  useEffect(() => {
    if (!runResult) return;
    const t = setTimeout(() => setRunResult(null), 1500);
    return () => clearTimeout(t);
  }, [runResult]);
  const onProgramExit = (code: number) => {
    runActivity.onExit(code);
    haptic(code === 0 ? 'success' : 'warning');
    setRunResult(code === 0 ? 'success' : 'error');
  };

  const sidebarWidth = sidebarRatio > 0 && bodyWidth > 0 ? Math.round(sidebarRatio * bodyWidth) : SIDEBAR_WIDTH;
  // iPad: Markdown, HTML and the like show beside their source.
  const sidePreview = wide && !splitOn && !!tabs.active && canToggle(tabs.active) && previewing(tabs.active);
  // A viewer covering an editor (a rendered preview) takes the keyboard away
  // from it, so typing doesn't go on editing the file out of sight.
  const leftCovered = !sidePreview && previewing(tabs.active);
  const rightCovered = splitOn && previewing(split.path);
  useEffect(() => {
    if (leftCovered) leftEditor.current?.send({ type: 'blur' });
  }, [leftCovered, tabs.active]);
  useEffect(() => {
    if (rightCovered) rightEditor.current?.send({ type: 'blur' });
  }, [rightCovered, split?.path]);
  const chromeHidden = keyboardOpen && !wide;
  const terminalShown = !terminalHidden || (keyboardOpen && typingIn === 'terminal');

  return (
    <Animated.View
      style={[
        styles.screen,
        { paddingTop: insets.top, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] },
      ]}
    >
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Projects" onPress={() => router.back()} testID="back" />
        <View style={styles.titleBox}>
          <Text variant="title" numberOfLines={1} style={styles.title}>
            {project}
          </Text>
          {git?.branch && (
            <Pressable onPress={openSourceControl} accessibilityRole="button" accessibilityLabel={`Branch ${git.branch}, ${changedCount} changed`} style={styles.subtitle} testID="header-branch">
              <Icon name="git-branch" size={10} color={styles.subtitleText.color} />
              <Text style={styles.subtitleText} numberOfLines={1}>
                {git.branch}
                {changedCount > 0 ? ` · ${changedCount} changed` : ''}
              </Text>
            </Pressable>
          )}
        </View>
        {canToggle(current) && (
          <IconButton
            icon={previewing(current) ? 'code' : 'eye'}
            label={previewing(current) ? 'Show source' : 'Show preview'}
            onPress={togglePreview}
            testID="toggle-preview"
          />
        )}
        <Pressable
          onPress={() => (running ? stopRunning() : runProject())}
          onLongPress={() => setPalette('commands')}
          accessibilityRole="button"
          accessibilityLabel={running ? 'Stop' : 'Run project'}
          accessibilityHint={running ? undefined : 'Long press for run configurations and tasks'}
          style={({ pressed }) => [styles.run, running && styles.stop, pressed && styles.runPressed]}
          ref={runTarget.ref}
          onLayout={runTarget.onLayout}
          testID="run-button"
        >
          <Icon name={running ? 'square' : 'play'} size={13} color={running ? styles.stopText.color : styles.runText.color} />
          <Text style={running ? styles.stopText : styles.runText}>{running ? 'Stop' : 'Run'}</Text>
        </Pressable>
        <View ref={paletteTarget.ref} onLayout={paletteTarget.onLayout}>
          <IconButton icon="command" label="Commands" onPress={() => setPalette('commands')} testID="open-palette" />
        </View>
      </View>
      <View style={styles.waveTrack}>
        <TideWave
          state={running ? 'running' : (runResult ?? 'idle')}
          color={colors.brand}
          done={{ success: colors.success, error: colors.destructive }}
        />
      </View>

      {deployStatus && (
        <Pressable
          onPress={() => (deployStatus.state === 'failed' ? router.push({ pathname: '/deploy', params: { project } }) : deployStore.getState().setStatus(project, undefined))}
          accessibilityRole="button"
          accessibilityLiveRegion="polite"
          style={[styles.deployBar, deployStatus.state === 'failed' && styles.deployFailed]}
          testID="deploy-status"
        >
          <Text variant="muted" numberOfLines={1} style={styles.deployText}>
            {deployStatus.state === 'deploying' ? `Deploying · ${deployStatus.message}` : deployStatus.state === 'done' ? `Deployed · ${deployStatus.url ?? ''}` : `Deploy failed · ${deployStatus.message}`}
          </Text>
        </Pressable>
      )}
      <View style={[styles.body, wide && styles.row]} onLayout={(e) => setBodyWidth(e.nativeEvent.layout.width)}>
        {wide && <ActivityBar vertical items={activityItems} active={activeActivity} onSelect={onActivity} targets={tourTargets} />}
        {wide && !sidebarHidden && (
          <>
            <View style={[styles.sidebar, { width: sidebarWidth }]} testID="sidebar">
              <FileTree project={project} nodes={tree ?? []} activePath={current} onOpenFile={openFile} reveal={reveal} />
            </View>
            <SplitDivider
              ratio={bodyWidth > 0 ? sidebarWidth / bodyWidth : 0.25}
              width={bodyWidth}
              onChange={setSidebarRatio}
              min={0.15}
              max={0.4}
              label="Files width"
              testID="sidebar-divider"
            />
          </>
        )}
        <View style={styles.body} onLayout={(e) => setMainHeight(e.nativeEvent.layout.height)}>
          <TabBar
            open={tabs.open}
            active={current}
            onSelect={openFile}
            dirty={dirty}
            onClose={(path) => closeFile(path)}
            pinned={tabs.pinned}
            onPin={(path) => tabsStore.getState().pinTab(project, path)}
            onUnpin={(path) => tabsStore.getState().unpinTab(project, path)}
            onCloseOthers={(path) => closeOtherTabs(path)}
            onReveal={revealInTree}
            compact={!wide}
          />
          {wide && current && !previewing(current) && (
            <Breadcrumbs
              project={project}
              path={current}
              // Tapping the path shows the file in the tree.
              onShowFiles={() => revealInTree(current)}
              onJump={(line) => openAt(current, line)}
            />
          )}

          {extensions.map((ext) => ext.bar && <ext.bar key={ext.id} ctx={ctx} />)}
          {/* Both panes stay mounted so the terminal keeps its scrollback and the editor its undo history. */}
          <View
            style={[styles.editor, (splitOn || sidePreview) && styles.row, keyboardOpen && typingIn === 'terminal' && !terminalHidden && styles.collapsed]}
            onLayout={(e) => setEditorWidth(e.nativeEvent.layout.width)}
          >
            <View style={[styles.pane, splitOn && { flex: splitRatio }, sidePreview && { flex: previewRatio }, splitOn && !rightFocused && styles.focusedPane]}>
              <EditorPane
                ref={leftEditor}
                project={project}
                path={tabs.active && viewerOnly(previewKind(tabs.active)) ? null : tabs.active}
                features={features}
                host={editorHost}
                onBrowse={() => (wide ? setPalette('files') : setDrawerOpen(true))}
                onFocusChange={(focused) => {
                  if (!focused) return;
                  setTypingIn('editor');
                  setFocusedPane('left');
                }}
                onShortcut={onShortcut}
                onActions={() => setEditorActions(true)}
                onCompletionState={setGhost}
                onFixProblem={(path, line) => setFixRequest({ kind: 'problem', path, line })}
              />
              {!sidePreview && viewer(tabs.active)}
            </View>
            {sidePreview && (
              <>
                <SplitDivider ratio={previewRatio} width={editorWidth} onChange={setPreviewRatio} label="Preview width" testID="preview-divider" />
                <View style={[styles.pane, { flex: 1 - previewRatio }]} testID="side-preview">
                  {viewer(tabs.active)}
                </View>
              </>
            )}
            {splitOn && (
              <>
                <SplitDivider ratio={splitRatio} width={editorWidth} onChange={setSplitRatio} />
                <View style={[styles.pane, { flex: 1 - splitRatio }, rightFocused && styles.focusedPane]} testID="right-editor">
                  <EditorPane
                    ref={rightEditor}
                    project={project}
                    path={split.path && viewerOnly(previewKind(split.path)) ? null : split.path}
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
                    onActions={() => setEditorActions(true)}
                    onCompletionState={setGhost}
                    onFixProblem={(path, line) => setFixRequest({ kind: 'problem', path, line })}
                  />
                  {viewer(split.path)}
                </View>
              </>
            )}
            {!keyboardOpen && <SuggestionBanner project={project} />}
            {liveWindow &&
              (() => {
                // Loaded on first use: it pulls in a WebView.
                const { LivePreviewWindow } = require('../preview/LivePreviewWindow') as typeof import('../preview/LivePreviewWindow');
                return <LivePreviewWindow project={project} path={current ?? null} onClose={() => setLiveWindow(false)} />;
              })()}
          </View>
          <View
            style={[
              styles.terminal,
              { height: Math.round(Math.max(120, mainHeight * terminalSize)) },
              keyboardOpen && typingIn === 'terminal' && !terminalHidden && styles.expanded,
              !terminalShown && styles.collapsed,
            ]}
            testID="terminal-sheet"
          >
            {!keyboardOpen && <TerminalGrabber fraction={terminalSize} height={mainHeight} onChange={setTerminalSize} onHide={() => setTerminalHidden(true)} />}
            <TerminalPanel
              project={project}
              ref={terminal}
              onFocusChange={(focused) => focused && setTypingIn('terminal')}
              onShortcut={onShortcut}
              onOpenFile={openPrinted}
              onShowProblems={() => setProblems(true)}
              onBusyChange={setRunning}
              onExit={onProgramExit}
              onOutput={(text) => runActivity.onOutput(text)}
              onHide={() => {
                terminal.current?.blur();
                setTerminalHidden(true);
              }}
            />
          </View>
        </View>
      </View>
      {keyboardOpen && (
        <View style={{ paddingBottom: keyboardHeight }}>
          {typingIn === 'terminal' && !terminalHidden ? (
            <TerminalKeyBar input={(data) => terminal.current?.input(data)} onHide={() => terminal.current?.blur()} />
          ) : (
            <EditorKeyBar send={(msg) => editor.current?.send(msg)} language={languageFor(current ?? '')} completion={ghost} />
          )}
        </View>
      )}
      {!chromeHidden && (
        <View style={wide ? { paddingBottom: keyboardOpen ? 0 : insets.bottom } : undefined}>
          <StatusBar
            project={project}
            path={current ?? null}
            running={running}
            onBranch={openSourceControl}
            onProblems={() => setProblems(true)}
            onGoToLine={() => current && setGoingToLine(true)}
            onMode={() => setTerminalHidden(false)}
          />
        </View>
      )}
      {!wide && !chromeHidden && <ActivityBar items={activityItems} active={activeActivity} onSelect={onActivity} bottomInset={insets.bottom} targets={tourTargets} />}

      {!wide && (
        <>
          {!drawerOpen && !keyboardOpen && <View {...edgeSwipe.panHandlers} style={[styles.edge, { top: insets.top + 44 }]} testID="drawer-edge" />}
          <Animated.View
            pointerEvents={drawerOpen ? 'auto' : 'none'}
            style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) }]}
          >
            <Pressable accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} accessibilityLabel="Close files" />
          </Animated.View>
          <Animated.View
            {...drawerSwipe.panHandlers}
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
            <FileTree project={project} nodes={tree ?? []} activePath={current} onOpenFile={openFile} reveal={reveal} />
          </Animated.View>
        </>
      )}
      <EditorTour />
      <ActionSheet
        title={editorActions ? 'Actions' : null}
        actions={[
          {
            label: 'Go to definition',
            icon: 'corner-down-right',
            onPress: () => cursor.current && editorHost.definition(cursor.current.path, cursor.current.offset),
          },
          { label: 'Peek definition', icon: 'eye', onPress: () => editor.current?.send({ type: 'peek' }) },
          { label: 'Look up in docs', icon: 'book', onPress: lookUpInDocs },
          { label: 'Find in file', icon: 'search', onPress: () => editor.current?.send({ type: 'find' }) },
          { label: 'Select line', icon: 'minus', onPress: () => editor.current?.send({ type: 'select', unit: 'line' }) },
          { label: 'Select all', icon: 'maximize', onPress: () => editor.current?.send({ type: 'select', unit: 'all' }) },
          { label: 'Share selection as image', icon: 'image', onPress: () => editor.current?.send({ type: 'shareImage', lineNumbers: true }) },
          { label: 'Command palette', icon: 'command', onPress: () => setPalette('commands') },
        ]}
        onClose={() => setEditorActions(false)}
      />
      <ActionSheet title={moreOpen ? project : null} actions={moreActions} onClose={() => setMoreOpen(false)} />

      <CommandPalette
        mode={palette}
        project={project}
        commands={commands}
        activePath={current ?? null}
        onOpenAt={openAt}
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
      {historyOf !== null &&
        (() => {
          // Loaded on first use, like the other sheets that pull in state at import.
          const { LocalHistorySheet } = require('../history/LocalHistorySheet') as typeof import('../history/LocalHistorySheet');
          return <LocalHistorySheet project={project} path={historyOf} onClose={() => setHistoryOf(null)} />;
        })()}
      <TestsSheet
        project={project}
        request={tests}
        onClose={() => setTests(null)}
        onOpen={(path, line) => (line ? openAt(path, line) : openFile(path))}
        onTerminal={(line) => {
          setTerminalHidden(false);
          runActivity.onRunStart(project, line, 'tests');
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
      <SourceControlSheet
        visible={sourceControl}
        project={project}
        onClose={() => {
          setSourceControl(false);
          gitStatusStore.getState().refresh(project).catch(() => undefined);
        }}
      />
      {panels.map(({ id, component: Panel }) => (
        <Panel key={id} ctx={ctx} visible={panel === id} onClose={() => setPanel((p) => (p === id ? null : p))} />
      ))}
      <SearchPanel visible={searching} project={project} onOpen={openAt} onClose={() => setSearching(false)} />
      <TodosPanel visible={todos} project={project} onOpen={openAt} onClose={() => setTodos(false)} />
      <AiSheet
        mode={ai}
        project={project}
        path={ai === 'error' && aiError ? aiError.path : (current ?? null)}
        errorOutput={aiError?.output ?? null}
        onClose={() => {
          setAi(null);
          setAiError(null);
        }}
      />
      <ProblemsPanel
        visible={problems}
        project={project}
        onOpen={openAt}
        onClose={() => setProblems(false)}
        onExplainError={() => explainLastError()}
        onFix={(request) => {
          setProblems(false);
          setFixRequest(request);
        }}
      />
      <FixSheet project={project} request={fixRequest} onClose={() => setFixRequest(null)} />
      <OutlinePanel visible={outline} project={project} path={current ?? null} onOpen={openAt} onClose={() => setOutline(false)} />
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
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  flexFill: { flex: 1 },
  deployBar: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, backgroundColor: colors.brandSoft },
  deployFailed: { backgroundColor: colors.destructiveSoft },
  deployText: { color: colors.foreground },
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 48,
    paddingHorizontal: spacing.xs + 2,
    backgroundColor: colors.card,
  },
  titleBox: { flex: 1, minWidth: 0, marginLeft: 2 },
  title: { fontSize: 15, lineHeight: 18 },
  subtitle: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start' },
  subtitleText: { fontFamily: fonts.sans.regular, fontSize: 11, color: colors.mutedForeground },
  run: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: 10, paddingRight: 12, borderRadius: radius.pill, backgroundColor: colors.brand, marginHorizontal: 2 },
  runPressed: { opacity: 0.75 },
  runText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: colors.brandForeground },
  stop: { backgroundColor: colors.destructiveSoft, borderWidth, borderColor: colors.destructive },
  stopText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: colors.destructive },
  waveTrack: { borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  edge: { position: 'absolute', left: 0, bottom: 0, width: EDGE_WIDTH },
  body: { flex: 1 },
  row: { flexDirection: 'row' },
  sidebar: { backgroundColor: colors.card },
  editor: { flex: 1 },
  pane: { flex: 1 },
  // A thin line marks which editor gets the key bar and commands.
  focusedPane: { borderTopWidth: 2, borderColor: colors.brand },
  terminal: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden', borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
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
