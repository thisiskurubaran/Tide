import { useCallback, useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { buffersStore, projectsStore, tabsStore } from '../../state';
import { projectTabs } from '../../state/tabs';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { lastLines, runGit } from './runGit';

interface Change {
  code: string;
  path: string;
}

type Status = { state: 'loading' } | { state: 'none' } | { state: 'repo'; branch: string; changes: Change[] };

// Short labels for porcelain codes, staged side first.
function describe(code: string) {
  if (code === '??') return 'new';
  const c = code.trim()[0];
  return c === 'M' ? 'modified' : c === 'A' ? 'added' : c === 'D' ? 'deleted' : code.trim();
}

export function SourceControlSheet({ visible, project, onClose }: { visible: boolean; project: string; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [status, setStatus] = useState<Status>({ state: 'loading' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState<{ text: string; failed: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const st = await runGit(localRunner, project, ['status', '-s']);
    if (st.code !== 0) {
      setStatus({ state: 'none' });
      return;
    }
    const br = await runGit(localRunner, project, ['branch']);
    const branch = /^\* (?:\x1b\[[0-9;]*m)?([^\x1b\n]+)/m.exec(br.stdout)?.[1] ?? 'HEAD';
    const changes = st.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }));
    setStatus({ state: 'repo', branch, changes });
  }, [project]);

  useEffect(() => {
    if (!visible) return;
    setOutput(null);
    setStatus({ state: 'loading' });
    refresh();
  }, [visible, refresh]);

  // Runs git steps in order, stopping at the first failure, and shows what git printed.
  async function act(label: string, steps: string[][]) {
    setBusy(label);
    let text = '';
    let failed = false;
    for (const args of steps) {
      const r = await runGit(localRunner, project, args);
      text += lastLines(r.stdout + r.stderr) + '\n';
      if (r.code !== 0) {
        failed = true;
        break;
      }
    }
    setOutput({ text: text.trim(), failed });
    setBusy(null);
    // Pulls and checkouts change files under the editor.
    await projectsStore.getState().loadTree(project);
    for (const path of projectTabs(tabsStore.getState(), project).open) await buffersStore.getState().reload(project, path);
    await refresh();
    return !failed;
  }

  async function commit() {
    // Unsaved editor text would otherwise be left out of the commit.
    await buffersStore.getState().flushProject(project);
    if (await act('commit', [['add', '-A'], ['commit', '-m', message.trim()]])) setMessage('');
  }

  const repo = status.state === 'repo' ? status : null;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.titleRow}>
        <Text variant="title">Source control</Text>
        {repo && (
          <Text variant="muted" testID="sc-branch">
            {repo.branch}
          </Text>
        )}
      </View>

      {status.state === 'loading' && <Text variant="muted">Reading git status...</Text>}
      {status.state === 'none' && (
        <>
          <Text variant="muted">This project is not a git repository yet.</Text>
          <View style={styles.actions}>
            <Button title="Initialize repository" icon="git-branch" onPress={() => act('init', [['init']])} disabled={busy !== null} testID="sc-init" />
          </View>
        </>
      )}
      {repo && (
        <>
          <ScrollView style={styles.changes} contentContainerStyle={styles.changesContent}>
            {repo.changes.length === 0 ? (
              <Text variant="muted">No changes since the last commit.</Text>
            ) : (
              repo.changes.map((c) => (
                <View key={c.path} style={styles.change}>
                  <Text variant="mono" numberOfLines={1} style={styles.path}>
                    {c.path}
                  </Text>
                  <Text variant="muted" style={{ color: c.code === '??' ? colors.success : c.code.includes('D') ? colors.destructive : colors.warning }}>
                    {describe(c.code)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          <TextInput
            testID="sc-message"
            value={message}
            onChangeText={setMessage}
            placeholder="Commit message"
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.brand}
            multiline
            style={styles.input}
          />
          <View style={styles.actions}>
            <Button title={busy === 'pull' ? 'Pulling...' : 'Pull'} variant="outline" icon="download" onPress={() => act('pull', [['pull']])} disabled={busy !== null} testID="sc-pull" />
            <Button title={busy === 'push' ? 'Pushing...' : 'Push'} variant="outline" icon="upload" onPress={() => act('push', [['push']])} disabled={busy !== null} testID="sc-push" />
            <Button
              title={busy === 'commit' ? 'Committing...' : 'Commit all'}
              icon="check"
              onPress={commit}
              disabled={busy !== null || !message.trim() || repo.changes.length === 0}
              testID="sc-commit"
            />
          </View>
        </>
      )}
      {output?.text ? (
        <Text variant="mono" style={[styles.output, output.failed && { color: colors.destructive }]} testID="sc-output">
          {output.text}
        </Text>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  changes: { maxHeight: 220 },
  changesContent: { gap: spacing.xs },
  change: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  path: { flex: 1 },
  input: {
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.sans.regular,
    fontSize: fontSizes.md,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  output: { fontSize: fontSizes.xs, color: colors.mutedForeground },
}));
