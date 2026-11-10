import { Icon } from '../../components/Icon';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, TextInput, TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '../../components/ActionSheet';
import { IconButton } from '../../components/Button';
import { FileBadge } from '../../components/FileBadge';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { useDiagnostics } from '../../extensions/diagnostics';
import { projectsStore, tabsStore, useBuffers, useProjects, useRecents, workspace } from '../../state';
import { isDirty, splitKey } from '../../state/buffers';
import { timeAgo } from '../../state/recents';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { exportProject, pickZip } from '../backup/actions';
import { SnapshotsSheet } from '../backup/SnapshotsSheet';
import { writeEntries } from '../backup/zip';
import { openFolderAsProject, useLinked } from '../external';
import { projectLink, projectPath } from '../launch/links';
import { launchedFromQuickAction } from '../launch/quickActions';
import { cloneRepo } from '../git/clone';
import { gitStatusStore, useGitStatus } from '../git/status';
import { projectHref } from './href';
import { NewProjectSheet } from './NewProjectSheet';
import { LanguageSummary, summarizeLanguages } from './summary';
import { makeStyles, useColors } from '../../theme/theme';
import { haptic } from '../../components/haptics';
import { WhatsNewOnUpdate } from '../support/WhatsNew';
import { EmptyProjects, uniqueProjectName } from '../onboarding/EmptyProjects';
import { Onboarding } from '../onboarding/Onboarding';
import { supportStore, useSupport } from '../support/store';

const mark = require('../../../assets/icons/splash.png');

export { projectHref } from './href';

// Everything outside a project, as a grid of tiles under the lists.
const PLACES = [
  { icon: 'github', label: 'GitHub', href: '/github', testID: 'open-github' },
  { icon: 'server', label: 'SSH', href: '/ssh', testID: 'open-ssh' },
  { icon: 'database', label: 'Databases', href: '/databases', testID: 'open-databases' },
  { icon: 'tool', label: 'Tools', href: '/tools', testID: 'open-tools' },
  { icon: 'book', label: 'Docs', href: '/docs', testID: 'open-docs' },
  { icon: 'package', label: 'Extensions', href: '/extensions', testID: 'open-extensions' },
] as const;

const MAX_RECENT_FILES = 5;
const NO_LANGUAGES: LanguageSummary = { badge: null, languages: [] };

// Reopen the last project once per launch; after that the list is the home screen.
let restoredLastProject = false;

const baseName = (path: string) => path.split('/').pop() ?? path;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function ProjectsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const projects = useProjects((s) => s.projects);
  const links = useLinked((s) => s.links);
  const onboarded = useSupport((s) => s.onboarded);
  const opened = useRecents((s) => s.projects);
  const recentFiles = useRecents((s) => s.files);
  const git = useGitStatus((s) => s.byProject);
  const buffers = useBuffers((s) => s.buffers);
  const diagnostics = useDiagnostics((s) => s.byProject);
  const [creating, setCreating] = useState<'template' | 'clone' | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [snapshotsFor, setSnapshotsFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [summaries, setSummaries] = useState<Record<string, LanguageSummary>>({});
  const [now, setNow] = useState(() => Date.now());
  const summarizing = useRef(new Set<string>());

  // tide://?new=1 and the "New project" quick action.
  const { new: startNew, search: startSearch } = useLocalSearchParams<{ new?: string; search?: string }>();
  useEffect(() => {
    if (startNew) setCreating('template');
  }, [startNew]);

  // tide://?search=1, from the Quick actions widget: focus the search field.
  const searchInput = useRef<TextInputInstance>(null);
  useEffect(() => {
    if (!startSearch) return;
    const t = setTimeout(() => searchInput.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [startSearch]);

  useEffect(() => {
    if (restoredLastProject) return;
    restoredLastProject = true;
    // A quick action picked from the home screen goes where it says instead.
    if (launchedFromQuickAction() || startNew || startSearch) return;
    const last = tabsStore.getState().lastProject;
    if (last && projectsStore.getState().projects.includes(last)) router.push(projectHref(last));
  }, []);

  // Branches and changes can move while a project is open, so they refresh
  // each time the list comes back into view, as does "2 min ago".
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      for (const p of projectsStore.getState().projects) gitStatusStore.getState().refresh(p).catch(() => undefined);
    }, [projects]),
  );

  // Each project's languages, read once per project while the screen lives.
  useEffect(() => {
    for (const p of projects) {
      if (summarizing.current.has(p)) continue;
      summarizing.current.add(p);
      workspace
        .listFiles(p)
        .then((paths) => setSummaries((s) => ({ ...s, [p]: summarizeLanguages(paths) })))
        .catch(() => setSummaries((s) => ({ ...s, [p]: NO_LANGUAGES })));
    }
  }, [projects]);

  const unsaved = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [key, b] of Object.entries(buffers)) {
      if (!isDirty(b)) continue;
      const [project] = splitKey(key);
      out[project] = (out[project] ?? 0) + 1;
    }
    return out;
  }, [buffers]);

  const problems = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [project, files] of Object.entries(diagnostics)) {
      let n = 0;
      for (const sources of Object.values(files)) for (const items of Object.values(sources)) n += items.filter((d) => d.severity !== 'info').length;
      if (n) out[project] = n;
    }
    return out;
  }, [diagnostics]);

  const q = query.trim().toLowerCase();
  const sorted = useMemo(
    () =>
      projects
        .map((name, i) => ({ name, i }))
        .sort((a, b) => (opened[b.name] ?? 0) - (opened[a.name] ?? 0) || a.i - b.i)
        .map((p) => p.name),
    [projects, opened],
  );
  const shown = q
    ? sorted.filter((p) => p.toLowerCase().includes(q) || (summaries[p]?.languages ?? []).some((l) => l.toLowerCase().includes(q)))
    : sorted;
  const files = recentFiles
    .filter((f) => projects.includes(f.project) && (!q || f.path.toLowerCase().includes(q) || f.project.toLowerCase().includes(q)))
    .slice(0, MAX_RECENT_FILES);

  function confirmDelete(name: string) {
    haptic('warning');
    Alert.alert(`Delete ${name}?`, 'This removes the project and all its files from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => projectsStore.getState().deleteProject(name) },
    ]);
  }

  function renderCard(item: string) {
    const summary = summaries[item] ?? NO_LANGUAGES;
    const status = git[item];
    const changed = status ? Object.keys(status.changes).length : 0;
    const dirty = unsaved[item] ?? 0;
    const issues = problems[item] ?? 0;
    const at = opened[item];
    const badge = summary.badge;
    const description = [
      item,
      links[item] && `linked to ${links[item].name}`,
      summary.languages.join(', '),
      status?.branch && `branch ${status.branch}`,
      changed && `${changed} changed`,
      dirty && `${dirty} unsaved`,
      issues && plural(issues, 'problem'),
      at && `opened ${timeAgo(at, now)}`,
    ]
      .filter(Boolean)
      .join(', ');
    return (
      <Pressable
        key={item}
        testID={`project-${item}`}
        onPress={() => router.push(projectHref(item))}
        onLongPress={() => setMenuFor(item)}
        accessibilityRole="button"
        accessibilityLabel={description}
        accessibilityHint="Opens the project"
        accessibilityActions={[{ name: 'longpress', label: 'More actions' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(item)}
        style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.secondary }]}
      >
        <View style={[styles.badge, { backgroundColor: (badge?.color ?? colors.mutedForeground) + '22' }]}>
          {badge ? (
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.badgeText, { color: badge.color }, badge.text.length > 2 && styles.badgeTextSmall]}>
              {badge.text}
            </Text>
          ) : (
            <Icon name="folder" size={16} color={colors.mutedForeground} />
          )}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item}
            </Text>
            {links[item] && <Icon name="link-2" size={13} color={colors.mutedForeground} />}
          </View>
          {summary.languages.length > 0 && (
            <Text variant="muted" style={styles.cardSubtitle} numberOfLines={1}>
              {summary.languages.join(' · ')}
            </Text>
          )}
          <View style={styles.meta}>
            {status?.branch && (
              <View style={styles.metaItem}>
                <Icon name="git-branch" size={11} color={colors.mutedForeground} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {status.branch}
                </Text>
              </View>
            )}
            {changed > 0 && <Text style={[styles.metaText, { color: colors.warning }]}>{changed} changed</Text>}
            {dirty > 0 && (
              <View style={[styles.pill, { backgroundColor: colors.warningSoft }]}>
                <Text style={[styles.pillText, { color: colors.warning }]}>{dirty} unsaved</Text>
              </View>
            )}
            {issues > 0 && (
              <View style={styles.metaItem}>
                <Icon name="alert-circle" size={11} color={colors.destructive} />
                <Text style={[styles.metaText, { color: colors.destructive }]}>{issues}</Text>
              </View>
            )}
            {at !== undefined && <Text style={styles.metaText}>{timeAgo(at, now)}</Text>}
          </View>
        </View>
        <IconButton icon="more-horizontal" label={`Actions for ${item}`} onPress={() => setMenuFor(item)} />
      </Pressable>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl, paddingLeft: insets.left + spacing.md, paddingRight: insets.right + spacing.md },
        ]}
      >
        <View style={styles.header}>
          <Image source={mark} style={styles.mark} accessibilityLabel="Tide" />
          <Text variant="title" style={styles.headerTitle}>
            Tide
          </Text>
          {__DEV__ && <IconButton icon="cpu" label="Runtime spike" onPress={() => router.push('/debug')} />}
          <IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} testID="open-settings" />
        </View>

        <View style={styles.search}>
          <Icon name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            ref={searchInput}
            testID="projects-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Search projects and files"
            placeholderTextColor={colors.mutedForeground}
            accessibilityLabel="Search projects and files"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="search"
            clearButtonMode="never"
            selectionColor={colors.brand}
            style={styles.searchInput}
          />
          {query.length > 0 && <IconButton icon="x" label="Clear search" onPress={() => setQuery('')} testID="projects-search-clear" />}
        </View>

        <View style={styles.actions}>
          <Pressable
            testID="new-project"
            onPress={() => setCreating('template')}
            accessibilityRole="button"
            accessibilityLabel="New project"
            style={({ pressed }) => [styles.action, styles.actionPrimary, pressed && styles.pressed]}
          >
            <Icon name="plus" size={16} color={colors.brandForeground} />
            <Text style={[styles.actionText, { color: colors.brandForeground }]}>New project</Text>
          </Pressable>
          <Pressable
            testID="clone-repo"
            onPress={() => setCreating('clone')}
            accessibilityRole="button"
            accessibilityLabel="Clone repo"
            style={({ pressed }) => [styles.action, styles.actionOutline, pressed && { backgroundColor: colors.secondary }]}
          >
            <Icon name="git-branch" size={16} color={colors.foreground} />
            <Text style={styles.actionText}>Clone repo</Text>
          </Pressable>
        </View>

        {/* The empty state carries its own heading. */}
        {projects.length > 0 && (
          <Text style={styles.section} accessibilityRole="header">
            Projects
          </Text>
        )}
        {projects.length === 0 ? (
          <EmptyProjects
            onSample={async (sample) => {
              try {
                const project = await projectsStore.getState().createProject(uniqueProjectName(sample.name, projectsStore.getState().projects), sample.template);
                haptic('success');
                router.push(projectHref(project));
              } catch (e) {
                haptic('error');
                Alert.alert("Couldn't create the project", e instanceof Error ? e.message : String(e));
              }
            }}
            onOpenFolder={() =>
              openFolderAsProject('')
                .then((project) => router.push(projectHref(project)))
                // Closing the picker rejects too; that's not worth an alert.
                .catch((e: Error) => !/cancel/i.test(e?.message ?? '') && Alert.alert("Couldn't open the folder", e.message))
            }
            onClone={() => setCreating('clone')}
          />
        ) : shown.length === 0 ? (
          <Text variant="muted" style={styles.noMatch}>
            No projects match "{query.trim()}"
          </Text>
        ) : (
          <View style={styles.cards}>{shown.map(renderCard)}</View>
        )}

        {files.length > 0 && (
          <>
            <Text style={styles.section} accessibilityRole="header">
              Recent files
            </Text>
            <View style={styles.list}>
              {files.map((f, i) => (
                <Pressable
                  key={`${f.project}/${f.path}`}
                  testID={`recent-file-${f.project}/${f.path}`}
                  onPress={() => router.push(projectPath(f.project, { file: f.path }))}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.path} in ${f.project}`}
                  accessibilityHint="Opens the file"
                  style={({ pressed }) => [styles.fileRow, i > 0 && styles.divider, pressed && { backgroundColor: colors.secondary }]}
                >
                  <FileBadge name={baseName(f.path)} />
                  <Text variant="mono" style={styles.fileName} numberOfLines={1}>
                    {baseName(f.path)}
                  </Text>
                  <Text variant="muted" style={styles.fileProject} numberOfLines={1}>
                    {f.project}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Text style={styles.section} accessibilityRole="header">
          Tools
        </Text>
        <View style={styles.grid}>
          {PLACES.map((p) => (
            <View key={p.href} style={styles.cell}>
              <Pressable
                onPress={() => router.push(p.href)}
                accessibilityRole="button"
                accessibilityLabel={p.label}
                style={({ pressed }) => [styles.tile, pressed && { backgroundColor: colors.secondary }]}
                testID={p.testID}
              >
                <Icon name={p.icon} size={18} color={colors.foreground} />
                <Text variant="label" style={styles.tileLabel} numberOfLines={1}>
                  {p.label}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>

      <NewProjectSheet
        visible={creating !== null}
        initialMode={creating ?? 'template'}
        onClose={() => setCreating(null)}
        onCreate={async (name, templateId) => {
          const project = await projectsStore.getState().createProject(name, templateId);
          haptic('success');
          setCreating(null);
          router.push(projectHref(project));
        }}
        onBrowseGitHub={() => {
          setCreating(null);
          router.push('/github');
        }}
        onClone={async (name, url) => {
          const project = await cloneRepo(name, url);
          setCreating(null);
          router.push(projectHref(project));
        }}
        onOpenFolder={async (name) => {
          const project = await openFolderAsProject(name);
          setCreating(null);
          router.push(projectHref(project));
        }}
        onImport={async (name) => {
          const picked = await pickZip();
          if (!picked) return;
          const project = await projectsStore.getState().cloneProject(name || picked.name, (p) => writeEntries(workspace, p, picked.entries));
          setCreating(null);
          router.push(projectHref(project));
        }}
      />

      <ActionSheet
        title={menuFor}
        onClose={() => setMenuFor(null)}
        actions={
          menuFor
            ? [
                { label: 'Rename', icon: 'edit-2', onPress: () => setRenaming(menuFor) },
                { label: 'Copy link', icon: 'link', onPress: () => Clipboard.setStringAsync(projectLink(menuFor)) },
                {
                  label: 'Export as .zip',
                  icon: 'share',
                  onPress: () => exportProject(menuFor).catch((e: Error) => Alert.alert("Couldn't export", e.message)),
                },
                { label: 'Snapshots', icon: 'clock', onPress: () => setSnapshotsFor(menuFor) },
                { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmDelete(menuFor) },
              ]
            : []
        }
      />

      <SnapshotsSheet project={snapshotsFor} onClose={() => setSnapshotsFor(null)} />
      <WhatsNewOnUpdate />
      <Onboarding
        visible={!onboarded}
        onDone={(create) => {
          supportStore.getState().setOnboarded(true);
          if (create) setCreating('template');
        }}
      />

      <PromptSheet
        visible={renaming !== null}
        title="Rename project"
        initialValue={renaming ?? ''}
        confirmLabel="Rename"
        onClose={() => setRenaming(null)}
        onSubmit={async (value) => {
          if (renaming) await projectsStore.getState().renameProject(renaming, value);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.sm + 2, width: '100%', maxWidth: 760, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, minHeight: 44 },
  mark: { width: 28, height: 28 },
  headerTitle: { flex: 1 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.xs,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: { flex: 1, minHeight: 42, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.sm, paddingVertical: 0 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
  },
  actionPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionOutline: { backgroundColor: 'transparent', borderColor: colors.border },
  actionText: { color: colors.foreground, fontFamily: fonts.sans.semibold, fontSize: fontSizes.sm },
  pressed: { opacity: 0.8 },
  section: {
    marginTop: spacing.sm + 2,
    color: colors.mutedForeground,
    fontFamily: fonts.sans.semibold,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  cards: { gap: spacing.xs + 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    minHeight: 64,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.xs,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  badge: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.mono.semibold, fontSize: 13, letterSpacing: -0.3 },
  badgeTextSmall: { fontSize: 10 },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  cardTitle: { flexShrink: 1, color: colors.foreground, fontFamily: fonts.sans.semibold, fontSize: 15 },
  cardSubtitle: { fontSize: fontSizes.xs },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm + 2, rowGap: 2, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 160 },
  metaText: { color: colors.mutedForeground, fontFamily: fonts.mono.regular, fontSize: 11 },
  pill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.mono.semibold, fontSize: 10.5 },
  noMatch: { paddingVertical: spacing.sm },
  list: { borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, minHeight: 44, paddingHorizontal: spacing.sm + 4 },
  divider: { borderTopWidth: borderWidth, borderTopColor: colors.border },
  fileName: { flex: 1, fontSize: 13 },
  fileProject: { maxWidth: '40%', fontSize: fontSizes.xs, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -(spacing.xs / 2) - 1 },
  cell: { width: '25%', padding: spacing.xs / 2 + 1 },
  tile: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    padding: spacing.xs,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  tileLabel: { fontSize: 11.5 },
}));
