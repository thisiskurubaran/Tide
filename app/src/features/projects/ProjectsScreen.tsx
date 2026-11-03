import Feather from '@expo/vector-icons/Feather';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { projectsStore, tabsStore, useProjects, workspace } from '../../state';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { exportProject, pickZip } from '../backup/actions';
import { SnapshotsSheet } from '../backup/SnapshotsSheet';
import { writeEntries } from '../backup/zip';
import { openFolderAsProject, useLinked } from '../external';
import { projectLink } from '../launch/links';
import { launchedFromQuickAction } from '../launch/quickActions';
import { cloneRepo } from '../git/clone';
import { projectHref } from './href';
import { NewProjectSheet } from './NewProjectSheet';
import { makeStyles, useColors } from '../../theme/theme';
import { haptic } from '../../components/haptics';
import { WhatsNewOnUpdate } from '../support/WhatsNew';
import { Onboarding } from '../onboarding/Onboarding';
import { supportStore, useSupport } from '../support/store';

const mark = require('../../../assets/icons/splash.png');

export { projectHref } from './href';

// Everything outside a project, under the title. As labeled chips: five icons don't fit beside it.
const PLACES = [
  { icon: 'github', label: 'GitHub', href: '/github', testID: 'open-github' },
  { icon: 'server', label: 'SSH', href: '/ssh', testID: 'open-ssh' },
  { icon: 'database', label: 'Databases', href: '/databases', testID: 'open-databases' },
  { icon: 'tool', label: 'Tools', href: '/tools', testID: 'open-tools' },
  { icon: 'package', label: 'Extensions', href: '/extensions', testID: 'open-extensions' },
] as const;

// Reopen the last project once per launch; after that the list is the home screen.
let restoredLastProject = false;

export function ProjectsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const projects = useProjects((s) => s.projects);
  const links = useLinked((s) => s.links);
  const onboarded = useSupport((s) => s.onboarded);
  const [creating, setCreating] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [snapshotsFor, setSnapshotsFor] = useState<string | null>(null);

  // tide://?new=1 and the "New project" quick action.
  const { new: startNew } = useLocalSearchParams<{ new?: string }>();
  useEffect(() => {
    if (startNew) setCreating(true);
  }, [startNew]);

  useEffect(() => {
    if (restoredLastProject) return;
    restoredLastProject = true;
    // A quick action picked from the home screen goes where it says instead.
    if (launchedFromQuickAction() || startNew) return;
    const last = tabsStore.getState().lastProject;
    if (last && projectsStore.getState().projects.includes(last)) router.push(projectHref(last));
  }, []);

  function confirmDelete(name: string) {
    haptic('warning');
    Alert.alert(`Delete ${name}?`, 'This removes the project and all its files from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => projectsStore.getState().deleteProject(name) },
    ]);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Image source={mark} style={styles.mark} accessibilityLabel="Tide" />
        <Text variant="heading" style={styles.headerTitle}>
          Projects
        </Text>
        {__DEV__ && <IconButton icon="cpu" label="Runtime spike" onPress={() => router.push('/debug')} />}
        <IconButton icon="settings" label="Settings" onPress={() => router.push('/settings')} testID="open-settings" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.placesBar} contentContainerStyle={styles.places}>
        {PLACES.map((p) => (
          <Pressable
            key={p.href}
            onPress={() => router.push(p.href)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.place, pressed && { backgroundColor: colors.secondary }]}
            testID={p.testID}
          >
            <Feather name={p.icon} size={15} color={colors.foreground} />
            <Text variant="label">{p.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={projects}
        keyExtractor={(name) => name}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 96 }]}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="title">No projects yet</Text>
            <Text variant="muted">Create one from a template to get started.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`project-${item}`}
            onPress={() => router.push(projectHref(item))}
            onLongPress={() => setMenuFor(item)}
            accessibilityRole="button"
            accessibilityLabel={links[item] ? `${item}, linked to ${links[item].name}` : item}
            accessibilityHint="Opens the project"
            accessibilityActions={[{ name: 'longpress', label: 'More actions' }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenuFor(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
          >
            <Feather name="folder" size={18} color={colors.brand} />
            <Text variant="label" style={styles.rowTitle} numberOfLines={1}>
              {item}
            </Text>
            {links[item] && <Feather name="link-2" size={14} color={colors.mutedForeground} accessibilityLabel={`Linked to ${links[item].name}`} />}
            <IconButton icon="more-horizontal" label={`Actions for ${item}`} onPress={() => setMenuFor(item)} />
          </Pressable>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button title="New project" icon="plus" onPress={() => setCreating(true)} testID="new-project" />
      </View>

      <NewProjectSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={async (name, templateId) => {
          const project = await projectsStore.getState().createProject(name, templateId);
          haptic('success');
          setCreating(false);
          router.push(projectHref(project));
        }}
        onBrowseGitHub={() => {
          setCreating(false);
          router.push('/github');
        }}
        onClone={async (name, url) => {
          const project = await cloneRepo(name, url);
          setCreating(false);
          router.push(projectHref(project));
        }}
        onOpenFolder={async (name) => {
          const project = await openFolderAsProject(name);
          setCreating(false);
          router.push(projectHref(project));
        }}
        onImport={async (name) => {
          const picked = await pickZip();
          if (!picked) return;
          const project = await projectsStore.getState().cloneProject(name || picked.name, (p) => writeEntries(workspace, p, picked.entries));
          setCreating(false);
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
          if (create) setCreating(true);
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 4,
  },
  mark: { width: 32, height: 32 },
  headerTitle: { flex: 1 },
  placesBar: { flexGrow: 0, marginBottom: spacing.md },
  places: { gap: spacing.sm, paddingHorizontal: spacing.md },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 3,
    borderRadius: 999,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  list: { paddingHorizontal: spacing.md, gap: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 4,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  rowTitle: { flex: 1, fontSize: fontSizes.md },
  empty: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl * 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
}));
