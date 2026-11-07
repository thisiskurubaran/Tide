import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { buffersStore } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { diffText } from '../../extensions/gitPro/diff';
import { DiffView } from '../../extensions/gitPro/DiffView';
import { timeAgo } from '../github/api';
import { fileHistory } from '.';
import { KEEP, type Version } from './history';

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

// Earlier versions of the open file: compare one with the current text and
// put it back. Restoring keeps the current text as a version too.
export function LocalHistorySheet({ project, path, onClose }: { project: string; path: string | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [picked, setPicked] = useState<Version | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [view, setView] = useState<'changes' | 'text'>('changes');

  useEffect(() => {
    setVersions(null);
    setPicked(null);
    if (path) fileHistory.list(project, path).then(setVersions, () => setVersions([]));
  }, [project, path]);

  useEffect(() => {
    setText(null);
    if (path && picked) fileHistory.read(project, path, picked.id).then(setText, () => setText(''));
  }, [project, path, picked]);

  const current = path ? (buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '') : '';
  const close = () => {
    setPicked(null);
    setView('changes');
    onClose();
  };
  const restore = async () => {
    if (!path || text === null) return;
    // Edit, then save: the editor can undo it, and history keeps what it replaced.
    buffersStore.getState().edit(project, path, text);
    await buffersStore.getState().save(project, path);
    haptic('success');
    close();
  };

  const name = path?.split('/').pop() ?? '';
  return (
    <Sheet visible={path !== null} onClose={close} scrollable>
      <Text variant="title">{picked ? timeAgo(new Date(picked.time).toISOString()) : `Local history: ${name}`}</Text>
      {!picked ? (
        <>
          {versions === null && <ActivityIndicator color={colors.mutedForeground} />}
          {versions?.length === 0 && <Text variant="muted">Versions show up here as you save. They're kept on this device, for the last {KEEP} saves of each file.</Text>}
          {versions?.map((v, i) => (
            <Pressable key={v.id} onPress={() => setPicked(v)} accessibilityRole="button" style={styles.row} testID={`history-version-${i}`}>
              <View style={styles.flex}>
                <Text variant="label">{timeAgo(new Date(v.time).toISOString())}</Text>
                <Text variant="muted">
                  {new Date(v.time).toLocaleString()} · {size(v.bytes)}
                </Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.actions}>
            <Button title="Done" onPress={close} />
          </View>
        </>
      ) : (
        <>
          <Segmented<'changes' | 'text'>
            value={view}
            onChange={setView}
            options={[
              { value: 'changes', label: 'Changes since' },
              { value: 'text', label: 'This version' },
            ]}
            testID="history-view"
          />
          {text === null ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : view === 'changes' ? (
            <DiffView hunks={diffText(text, current)} empty="Same as the current text." />
          ) : (
            <Text variant="mono" selectable style={styles.body}>
              {text || '(empty file)'}
            </Text>
          )}
          <View style={styles.actions}>
            <Button title="Back" variant="outline" onPress={() => (setPicked(null), setView('changes'))} />
            <Button title="Restore this version" icon="rotate-ccw" onPress={restore} disabled={text === null || text === current} testID="history-restore" />
          </View>
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border },
  body: { fontSize: fontSizes.xs + 1, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
