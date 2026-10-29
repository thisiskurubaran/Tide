import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { projectsStore, tabsStore, useProjects } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { projectHref } from '../projects/ProjectsScreen';
import { incomingFile } from './incoming';
import { addToProject, discardIncoming, importZip } from './share';

// Where "Open in Tide" lands. A .zip becomes a new project; any other file is
// copied into a project of your choosing (or a new one) and opened.
export function OpenIncomingScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const incoming = uri ? incomingFile(uri) : null;
  const projects = useProjects((s) => s.projects);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (incoming) setName(incoming.kind === 'zip' ? incoming.name.replace(/\.zip$/i, '') : '');
  }, [incoming?.uri]);

  async function run(step: () => Promise<{ project: string; path?: string }>) {
    if (!incoming) return;
    setBusy(true);
    setError(null);
    try {
      const { project, path } = await step();
      discardIncoming(incoming);
      if (path) tabsStore.getState().openTab(project, path);
      router.replace(projectHref(project));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="x" label="Cancel" onPress={close} testID="cancel-open" />
        <Text variant="title" numberOfLines={1} style={styles.flex}>
          {incoming ? incoming.name : 'Nothing to open'}
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        {!incoming && <Text variant="muted">Tide couldn't read what was shared with it.</Text>}
        {error && <Text variant="error">{error}</Text>}
        {incoming && (
          <>
            <Text variant="muted">
              {incoming.kind === 'zip' ? 'Import the zip as a new project.' : 'Add the file to a project, or start a new project with it.'}
            </Text>
            <TextInput
              testID="incoming-project-name"
              value={name}
              onChangeText={setName}
              placeholder="New project name"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={colors.brand}
              style={styles.input}
            />
            <Button
              title={incoming.kind === 'zip' ? 'Import as new project' : 'New project with this file'}
              icon="plus"
              disabled={busy || (incoming.kind === 'file' && !name.trim())}
              testID="incoming-new-project"
              onPress={() =>
                run(async () => {
                  if (incoming.kind === 'zip') return { project: await importZip(incoming, name.trim()) };
                  const project = await projectsStore.getState().cloneProject(name.trim(), async () => undefined);
                  return { project, path: await addToProject(incoming, project) };
                })
              }
            />
            {incoming.kind === 'file' && projects.length > 0 && (
              <View style={styles.list}>
                <Text variant="label">Add to a project</Text>
                {projects.map((p) => (
                  <Pressable accessibilityRole="button"
                    key={p}
                    testID={`incoming-to-${p}`}
                    disabled={busy}
                    onPress={() => run(async () => ({ project: p, path: await addToProject(incoming, p) }))}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
                  >
                    <Feather name="folder" size={18} color={colors.brand} />
                    <Text style={styles.flex} numberOfLines={1}>
                      {p}
                    </Text>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  content: { padding: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.md,
  },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
}));
