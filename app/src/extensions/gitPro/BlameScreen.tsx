import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { buffersStore, workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { timeAgo } from '../../features/github/api';
import { runGit } from '../../features/git/runGit';
import { Blame, CommitInfo, createGitPro } from './api';
import { diffText, Hunk } from './diff';
import { DiffView } from './DiffView';

type Commit = Omit<CommitInfo, 'parents'>;

const when = (c: Commit) => timeAgo(new Date(c.timestamp * 1000).toISOString());
const short = (oid: string) => oid.slice(0, 7);
const subject = (c: Commit) => c.message.split('\n')[0];

// Who last changed each line of a file, and every commit that changed it.
export function BlameScreen() {
  const { project, path, show } = useLocalSearchParams<{ project: string; path: string; show?: 'history' }>();
  const styles = useStyles();
  const colors = useColors();
  const git = useMemo(() => createGitPro((args) => runGit(localRunner, project, args)), [project]);
  const [mode, setMode] = useState<'blame' | 'history'>(show === 'history' ? 'history' : 'blame');
  const [blame, setBlame] = useState<Blame | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [history, setHistory] = useState<CommitInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Commit | null>(null);
  const [hunks, setHunks] = useState<Hunk[] | null | 'loading'>('loading');

  useEffect(() => {
    (async () => {
      // Blame reads the file on disk, so unsaved edits go there first.
      await buffersStore.getState().flushProject(project);
      const [b, text] = await Promise.all([git.blame(path), workspace.readFile(project, path)]);
      setLines(text.replace(/\n$/, '').split('\n'));
      setBlame(b);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    git.fileLog(path).then(setHistory, () => setHistory([]));
  }, [git, project, path]);

  useEffect(() => {
    if (!shown) return;
    setHunks('loading');
    git.commitFile(shown.oid, path).then(
      (v) => setHunks(v.binary ? null : diffText(v.before ?? '', v.after ?? '')),
      () => setHunks(null),
    );
  }, [git, shown, path]);

  const name = path.split('/').pop() ?? path;
  return (
    <Screen title={name} subtitle={mode === 'blame' ? 'Blame' : 'File history'} scroll={false} testID="blame">
      <View style={styles.bar}>
        <Segmented<'blame' | 'history'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'blame', label: 'Blame' },
            { value: 'history', label: `History${history ? ` (${history.length})` : ''}` },
          ]}
          testID="blame-mode"
        />
      </View>
      {error && (
        <Text variant="error" style={styles.pad} selectable>
          {error}
        </Text>
      )}
      {mode === 'blame' ? (
        !blame && !error ? (
          <ActivityIndicator style={styles.pad} color={colors.mutedForeground} />
        ) : blame?.binary ? (
          <Text variant="muted" style={styles.pad}>
            This is a binary file, so there are no lines to blame.
          </Text>
        ) : blame ? (
          <ScrollView contentContainerStyle={styles.list}>
            {blame.runs.map((run) => {
              const c = run.oid ? blame.commits[run.oid] : null;
              return (
                <Pressable
                  key={run.start}
                  onPress={() => c && setShown(c)}
                  disabled={!c}
                  accessibilityRole={c ? 'button' : undefined}
                  accessibilityLabel={c ? `Lines ${run.start} to ${run.start + run.count - 1}: ${subject(c)}, by ${c.author}, ${when(c)}` : 'Not committed yet'}
                  style={styles.run}
                  testID={`blame-run-${run.start}`}
                >
                  <View style={styles.who}>
                    <Text variant="label" numberOfLines={1}>
                      {c ? subject(c) : 'Not committed yet'}
                    </Text>
                    {c && (
                      <Text variant="muted" numberOfLines={1}>
                        {c.author} · {when(c)} · {short(c.oid)}
                      </Text>
                    )}
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      {lines.slice(run.start - 1, run.start - 1 + run.count).map((line, i) => (
                        <Text key={i} style={styles.code} numberOfLines={1}>
                          <Text style={[styles.code, { color: colors.mutedForeground }]}>{String(run.start + i).padStart(4)} </Text>
                          {line || ' '}
                        </Text>
                      ))}
                    </View>
                  </ScrollView>
                </Pressable>
              );
            })}
            {blame.truncated && <Text variant="muted">Lines from before the oldest commit shown here are given to it.</Text>}
          </ScrollView>
        ) : null
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {history === null && <ActivityIndicator color={colors.mutedForeground} />}
          {history?.length === 0 && <Text variant="muted">No commits have changed this file yet.</Text>}
          {history?.map((c) => (
            <Pressable key={c.oid} onPress={() => setShown(c)} accessibilityRole="button" style={styles.commit} testID={`history-${short(c.oid)}`}>
              <Text variant="label" numberOfLines={2}>
                {subject(c)}
              </Text>
              <Text variant="muted">
                {c.author} · {when(c)} · {short(c.oid)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Sheet visible={shown !== null} onClose={() => setShown(null)} scrollable>
        {shown && (
          <>
            <Text variant="title">{subject(shown)}</Text>
            <Text variant="muted">
              {shown.author} · {when(shown)} · {short(shown.oid)}
            </Text>
            {shown.message.includes('\n') && <Text selectable>{shown.message.split('\n').slice(1).join('\n').trim()}</Text>}
            <Text variant="label">Changes to {name}</Text>
            {hunks === 'loading' ? <ActivityIndicator color={colors.mutedForeground} /> : <DiffView hunks={hunks} empty="No changes to this file." />}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  pad: { padding: spacing.md },
  list: { padding: spacing.sm, gap: spacing.xs },
  run: { borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  who: { gap: 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.secondary },
  code: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs + 1, color: colors.foreground, paddingHorizontal: spacing.sm, lineHeight: 18 },
  commit: { gap: 2, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
}));
