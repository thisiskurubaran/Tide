import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { buffersStore, projectsStore, snapshots } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import type { Snapshot } from './snapshots';
import { haptic } from '../../components/haptics';

const REASONS: Record<Snapshot['reason'], string> = {
  auto: 'Automatic',
  manual: 'Taken by you',
  'before-restore': 'Before a restore',
  'before-pull': 'Before pulling from a folder',
};

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Lists a project's snapshots; restore one, take one now, or delete one.
export function SnapshotsSheet({ project, onClose }: { project: string | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (project) snapshots.list(project).then(setList, (e: Error) => setError(e.message));
  }, [project]);
  useEffect(() => {
    setList(null);
    setError(null);
    load();
  }, [load]);

  async function run(step: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      load();
    }
  }

  const restore = (s: Snapshot) =>
    Alert.alert('Restore this snapshot?', 'Files go back to how they were. A snapshot of how they are now is taken first, so you can undo this.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            if (!project) return;
            // Unsaved edits are saved first, so they are in the "before restore" snapshot.
            await buffersStore.getState().flushProject(project);
            await snapshots.restore(project, s.id);
            haptic('success');
            await projectsStore.getState().loadTree(project);
            await buffersStore.getState().reloadProject(project);
          }),
      },
    ]);

  return (
    <Sheet visible={project !== null} onClose={onClose}>
      <Text variant="title">Snapshots</Text>
      <Text variant="muted">Copies of {project} on this device, taken automatically at most once an hour when you open it. node_modules, .git and .pylibs aren't included.</Text>
      {error && <Text variant="error">{error}</Text>}
      <ScrollView style={styles.list}>
        {list === null && <Text variant="muted">Loading...</Text>}
        {list?.length === 0 && <Text variant="muted">No snapshots yet.</Text>}
        {list?.map((s) => (
          <View key={s.id} style={styles.row} testID={`snapshot-${s.id}`}>
            <Feather name={s.reason === 'manual' ? 'bookmark' : 'clock'} size={16} color={colors.mutedForeground} />
            <View style={styles.flex}>
              <Text>{new Date(s.time).toLocaleString()}</Text>
              <Text variant="muted">
                {REASONS[s.reason]} · {size(s.bytes)}
              </Text>
            </View>
            <Button title="Restore" variant="outline" onPress={() => restore(s)} disabled={busy} testID={`restore-${s.id}`} />
            <IconButton icon="trash-2" label="Delete snapshot" onPress={() => run(() => snapshots.remove(project!, s.id))} />
          </View>
        ))}
      </ScrollView>
      <Button
        title={busy ? 'Working...' : 'Take a snapshot now'}
        icon="camera"
        onPress={() =>
          run(async () => {
            if (!project) return;
            await buffersStore.getState().flushProject(project);
            await snapshots.take(project, 'manual');
          })
        }
        disabled={busy}
        testID="take-snapshot"
      />
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 360 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  flex: { flex: 1 },
}));
