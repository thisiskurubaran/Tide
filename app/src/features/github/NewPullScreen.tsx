import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Loading, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { github } from './account';
import { timeAgo } from './api';
import { DiffList } from './DiffList';
import { itemHref } from './GitHubHome';

// Pick the branches, see the commits and changes between them, then open the pull request.
export function NewPullScreen() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const styles = useStyles();
  const colors = useColors();
  const setup = useAsync(async () => {
    const [info, branches] = await Promise.all([github().repo(owner, repo), github().branches(owner, repo)]);
    return { info, branches: branches.map((b) => b.name) };
  }, [owner, repo]);
  const [base, setBase] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup.value) return;
    const def = setup.value.info.default_branch;
    setBase((b) => b ?? def);
    setHead((h) => h ?? setup.value!.branches.find((b) => b !== def) ?? null);
  }, [setup.value]);

  const comparison = useAsync(async () => (base && head && base !== head ? github().compare(owner, repo, base, head) : null), [owner, repo, base, head]);
  const commits = comparison.value?.commits ?? [];
  // One commit: its message makes a good title, like GitHub does.
  useEffect(() => {
    if (!title && commits.length === 1) setTitle(commits[0].commit.message.split('\n')[0]);
  }, [commits, title]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const pr = await github().createPull(owner, repo, { head: head!, base: base!, title: title.trim(), body, draft });
      haptic('success');
      router.replace(itemHref(owner, repo, pr.number, true));
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const branchChips = (value: string | null, onPick: (b: string) => void, testID: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {setup.value?.branches.map((b) => (
        <Pressable key={b} onPress={() => onPick(b)} accessibilityRole="radio" accessibilityState={{ selected: value === b }} style={[styles.chip, value === b && styles.chipOn]} testID={`${testID}-${b}`}>
          <Text variant="mono">{b}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const ready = base && head && base !== head && comparison.value && comparison.value.ahead_by > 0 && title.trim();

  return (
    <Screen title="New pull request" subtitle={`${owner}/${repo}`} scroll={false} testID="github-new-pull">
      {!setup.value ? (
        setup.error ? <Text variant="error" style={styles.pad}>{setup.error}</Text> : <Loading />
      ) : (
        <DiffList
          files={comparison.value?.files ?? []}
          header={
            <View style={styles.form}>
              <Text variant="label">Merge into</Text>
              {branchChips(base, setBase, 'base')}
              <Text variant="label">From</Text>
              {branchChips(head, setHead, 'head')}
              {base === head && <Text variant="muted">Pick two different branches.</Text>}
              {comparison.loading && base !== head && <Loading />}
              {comparison.error && <Text variant="error">{comparison.error}</Text>}
              {comparison.value && (
                <View style={styles.summary}>
                  <Text variant="label">
                    {comparison.value.ahead_by === 0
                      ? `${head} has nothing new for ${base}.`
                      : `${comparison.value.ahead_by} ${comparison.value.ahead_by === 1 ? 'commit' : 'commits'}, ${comparison.value.files?.length ?? 0} files changed`}
                  </Text>
                  {comparison.value.behind_by > 0 && <Text variant="muted">{head} is {comparison.value.behind_by} commits behind {base}.</Text>}
                  {commits.slice(-20).reverse().map((c) => (
                    <Text key={c.sha} variant="muted" numberOfLines={1}>
                      <Text variant="mono" style={{ color: colors.brand }}>{c.sha.slice(0, 7)}</Text> {c.commit.message.split('\n')[0]}
                      {c.commit.author ? ` · ${timeAgo(c.commit.author.date)}` : ''}
                    </Text>
                  ))}
                </View>
              )}
              <Text variant="label">Title</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder="What does this change?" placeholderTextColor={colors.mutedForeground} selectionColor={colors.brand} style={styles.input} testID="new-pull-title" />
              <Text variant="label">Description</Text>
              <TextInput value={body} onChangeText={setBody} multiline placeholder="Markdown is supported" placeholderTextColor={colors.mutedForeground} selectionColor={colors.brand} style={[styles.input, styles.multiline]} testID="new-pull-body" />
              <Pressable onPress={() => setDraft((d) => !d)} accessibilityRole="checkbox" accessibilityState={{ checked: draft }} style={styles.row}>
                <View style={[styles.box, draft && { backgroundColor: colors.brand, borderColor: colors.brand }]} />
                <Text>Open as a draft</Text>
              </Pressable>
              {error && <Text variant="error" selectable>{error}</Text>}
              <Button title={busy ? 'Creating…' : 'Create pull request'} icon="git-pull-request" onPress={create} disabled={busy || !ready} testID="new-pull-create" />
              {comparison.value?.files?.length ? <Text variant="label" style={styles.changes}>Changes</Text> : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: { padding: spacing.md },
  form: { padding: spacing.sm, gap: spacing.sm },
  chips: { gap: spacing.sm },
  chip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  summary: { gap: 4, padding: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  input: { minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card, color: colors.foreground, fontSize: fontSizes.md },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: colors.border },
  changes: { marginTop: spacing.sm },
}));
