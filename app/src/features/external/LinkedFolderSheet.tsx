import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import { linkedStore, linkFolder, pullFolder, pushFolder, regrantFolder, useLinked } from './index';
import type { SyncResult } from './sync';
import { haptic } from '../../components/haptics';

const summary = (r: SyncResult, verb: string) => {
  const parts = [`${r.written} ${r.written === 1 ? 'file' : 'files'} ${verb}`];
  if (r.removed) parts.push(`${r.removed} deleted`);
  return parts.join(', ');
};

// Access to an outside folder lapses (iOS restarts, a moved folder); the
// errors don't say so plainly, so any failure offers to pick it again.
const looksLikeAccess = (message: string) => /permission|denied|access|not exist|no longer|security|EACCES|ENOENT/i.test(message);

// The project's linked folder: pull, push, write saves through, or unlink.
export function LinkedFolderSheet({ project, onClose }: { project: string | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const link = useLinked((s) => (project ? s.links[project] : undefined));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(step: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus((await step()) ?? null);
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sync = (direction: 'pull' | 'push') =>
    run(async () => {
      if (!project) return;
      const r = direction === 'pull' ? await pullFolder(project) : await pushFolder(project);
      haptic('success');
      const note = r.overwritten.length ? `. Changed on both sides, ${direction === 'pull' ? 'the folder' : 'this copy'} won: ${r.overwritten.join(', ')}` : '';
      return summary(r, direction === 'pull' ? 'updated here' : 'written to the folder') + note;
    });

  const unlink = () =>
    Alert.alert(`Unlink ${link?.name}?`, 'The project stays here with its files; it just stops syncing with the folder.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unlink', style: 'destructive', onPress: () => project && linkedStore.getState().unlink(project) },
    ]);

  return (
    <Sheet visible={project !== null} onClose={onClose}>
      <Text variant="title">Linked folder</Text>
      {!link ? (
        <>
          <Text variant="muted">
            Link {project} to a folder in Files, iCloud Drive or another app, then pull its files in or push yours out. Saves can go to the folder as you work.
          </Text>
          <Button title="Choose a folder" icon="folder-plus" onPress={() => run(() => linkFolder(project!))} disabled={busy} testID="link-folder" />
        </>
      ) : (
        <>
          <View style={styles.row}>
            <Feather name="folder" size={18} color={colors.brand} />
            <View style={styles.flex}>
              <Text variant="label">{link.name}</Text>
              <Text variant="muted">{link.syncedAt ? `Synced ${new Date(link.syncedAt).toLocaleString()}` : 'Not synced yet'}</Text>
            </View>
          </View>
          <View style={styles.row}>
            <Text style={styles.flex}>Write saved files to the folder</Text>
            <Switch
              testID="push-on-save"
              value={link.pushOnSave}
              onValueChange={(on) => linkedStore.getState().update(project!, { pushOnSave: on })}
              trackColor={{ true: colors.brand }}
            />
          </View>
          {status && <Text variant="muted">{status}</Text>}
          {error && (
            <>
              <Text variant="error">{error}</Text>
              {looksLikeAccess(error) && (
                <Button title="Choose the folder again" variant="outline" icon="unlock" onPress={() => run(() => regrantFolder(project!))} />
              )}
            </>
          )}
          <View style={styles.actions}>
            <Button title="Pull" variant="outline" icon="download" onPress={() => sync('pull')} disabled={busy} testID="pull-folder" />
            <Button title="Push" variant="outline" icon="upload" onPress={() => sync('push')} disabled={busy} testID="push-folder" />
            <Button title="Unlink" variant="outline" icon="link-2" onPress={unlink} disabled={busy} />
          </View>
          <Text variant="muted">Pull copies the folder's changes here, push the other way. Files deleted on one side since the last sync are deleted on the other; node_modules and .git are left alone.</Text>
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
