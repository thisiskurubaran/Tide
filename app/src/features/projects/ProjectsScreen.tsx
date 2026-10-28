import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { PromptSheet } from '../../components/PromptSheet';
import { Text } from '../../components/Text';
import { projectsStore, tabsStore, useProjects } from '../../state';
import { borderWidth, colors, fontSizes, radius, spacing } from '../../theme/tokens';
import { NewProjectSheet } from './NewProjectSheet';

const mark = require('../../../assets/icons/splash-dark.png');

export const projectHref = (name: string) => `/project/${encodeURIComponent(name)}` as const;

// Reopen the last project once per launch; after that the list is the home screen.
let restoredLastProject = false;

export function ProjectsScreen() {
  const insets = useSafeAreaInsets();
  const projects = useProjects((s) => s.projects);
  const [creating, setCreating] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    if (restoredLastProject) return;
    restoredLastProject = true;
    const last = tabsStore.getState().lastProject;
    if (last && projectsStore.getState().projects.includes(last)) router.push(projectHref(last));
  }, []);

  function confirmDelete(name: string) {
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
        <IconButton icon="server" label="Remote server" onPress={() => router.push('/settings')} testID="open-settings" />
      </View>

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
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
          >
            <Feather name="folder" size={18} color={colors.brand} />
            <Text variant="label" style={styles.rowTitle} numberOfLines={1}>
              {item}
            </Text>
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
                { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => confirmDelete(menuFor) },
              ]
            : []
        }
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  mark: { width: 32, height: 32 },
  headerTitle: { flex: 1 },
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
});
