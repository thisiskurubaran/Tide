import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { HtmlView } from '../../components/HtmlView';
import { Badge, Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, spacing } from '../../theme/tokens';
import { github } from './account';
import { MergeMethod, ReviewEvent } from './api';
import { conversationHtml, filesHtml } from './render';
import { runColor, runLabel } from './RepoScreen';

type Tab = 'conversation' | 'files' | 'checks';

export function PullScreen() {
  const { owner, repo, number } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();
  const n = Number(number);
  const styles = useStyles();
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('conversation');
  const [sheet, setSheet] = useState<'comment' | ReviewEvent | null>(null);
  const [merging, setMerging] = useState(false);

  const data = useAsync(async () => {
    const gh = github();
    const [pull, comments, reviews] = await Promise.all([gh.pull(owner, repo, n), gh.comments(owner, repo, n), gh.reviews(owner, repo, n)]);
    return { pull, comments, reviews };
  }, [owner, repo, n]);
  const files = useAsync(() => (tab === 'files' ? github().pullFiles(owner, repo, n) : Promise.resolve(null)), [tab, owner, repo, n]);
  const checks = useAsync(() => (tab === 'checks' && data.value ? github().checks(owner, repo, data.value.pull.head.sha) : Promise.resolve(null)), [tab, data.value]);

  const pull = data.value?.pull;
  const state = pull ? (pull.merged_at ? 'Merged' : pull.state === 'open' ? (pull.draft ? 'Draft' : 'Open') : 'Closed') : '';
  const stateColor = state === 'Merged' ? colors.brand : state === 'Open' ? colors.success : colors.mutedForeground;

  const merge = async (method: MergeMethod) => {
    try {
      await github().merge(owner, repo, n, method);
      haptic('success');
      data.reload();
    } catch (e) {
      haptic('error');
      Alert.alert('Merge failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={pull ? pull.title : `#${n}`}
      subtitle={`${owner}/${repo} #${n}`}
      scroll={false}
      testID="github-pull"
      actions={<IconButton icon="external-link" label="Open on GitHub" onPress={() => pull && Linking.openURL(pull.html_url)} />}
    >
      {data.error && <Text variant="error" style={styles.pad}>{data.error}</Text>}
      {!pull ? (
        data.loading && <Loading />
      ) : (
        <>
          <View style={styles.meta}>
            <View style={styles.row}>
              <Badge label={state} color={stateColor} />
              <Text variant="muted" style={styles.flex} numberOfLines={2}>
                {pull.user.login} wants to merge <Text variant="mono">{pull.head.ref}</Text> into <Text variant="mono">{pull.base.ref}</Text>
              </Text>
            </View>
            <Text variant="muted">
              {pull.changed_files ?? 0} files · <Text style={{ color: colors.success }}>+{pull.additions ?? 0}</Text> <Text style={{ color: colors.destructive }}>−{pull.deletions ?? 0}</Text>
            </Text>
            <Segmented<Tab>
              testID="pull-tab"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'conversation', label: 'Conversation' },
                { value: 'files', label: 'Files' },
                { value: 'checks', label: 'Checks' },
              ]}
            />
          </View>
          <View style={styles.flex}>
            {tab === 'conversation' && <HtmlView body={conversationHtml(pull, data.value!.comments, data.value!.reviews)} testID="pull-conversation" />}
            {tab === 'files' && (files.value ? <HtmlView body={filesHtml(files.value)} testID="pull-files" /> : files.error ? <Text variant="error" style={styles.pad}>{files.error}</Text> : <Loading />)}
            {tab === 'checks' && (
              <View style={styles.pad}>
                {checks.loading && <Loading />}
                {checks.value?.length === 0 && <Empty title="No checks" body="This repository has no checks for the latest commit." />}
                {checks.value?.map((c) => (
                  <ListRow
                    key={c.id}
                    icon={c.status === 'completed' ? (c.conclusion === 'success' ? 'check-circle' : 'x-circle') : 'loader'}
                    iconColor={runColor(c, colors)}
                    title={c.name}
                    subtitle={runLabel(c)}
                    onPress={() => Linking.openURL(c.html_url)}
                  />
                ))}
              </View>
            )}
          </View>
          <View style={styles.bar}>
            <Button title="Comment" variant="outline" icon="message-square" onPress={() => setSheet('comment')} testID="pull-comment" />
            {pull.state === 'open' && <Button title="Review" variant="outline" icon="check-square" onPress={() => setSheet('APPROVE')} testID="pull-review" />}
            {pull.state === 'open' && !pull.draft && <Button title="Merge" icon="git-merge" onPress={() => setMerging(true)} testID="pull-merge" />}
          </View>
        </>
      )}
      <FormSheet
        visible={sheet === 'comment'}
        title="Comment"
        confirmLabel="Comment"
        fields={[{ key: 'body', label: 'Comment', multiline: true, required: true, placeholder: 'Markdown is supported' }]}
        onClose={() => setSheet(null)}
        onSubmit={async ({ body }) => {
          await github().comment(owner, repo, n, body);
          haptic('success');
          setSheet(null);
          data.reload();
        }}
      />
      <FormSheet
        visible={sheet !== null && sheet !== 'comment'}
        title="Review"
        confirmLabel="Submit review"
        fields={[
          {
            key: 'event',
            label: 'Your review',
            choices: [
              { value: 'APPROVE', label: 'Approve' },
              { value: 'REQUEST_CHANGES', label: 'Request changes' },
              { value: 'COMMENT', label: 'Comment' },
            ],
          },
          { key: 'body', label: 'Summary', multiline: true, placeholder: 'Optional when approving' },
        ]}
        onClose={() => setSheet(null)}
        onSubmit={async ({ event, body }) => {
          if (event !== 'APPROVE' && !body.trim()) throw new Error('Add a summary for this kind of review.');
          await github().review(owner, repo, n, event as ReviewEvent, body);
          haptic('success');
          setSheet(null);
          data.reload();
        }}
      />
      <ActionSheet
        title={merging ? 'Merge pull request' : null}
        onClose={() => setMerging(false)}
        actions={[
          { label: 'Create a merge commit', icon: 'git-merge', onPress: () => merge('merge') },
          { label: 'Squash and merge', icon: 'minimize-2', onPress: () => merge('squash') },
          { label: 'Rebase and merge', icon: 'git-commit', onPress: () => merge('rebase') },
        ]}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  pad: { padding: spacing.sm, gap: spacing.sm },
  meta: { padding: spacing.sm, gap: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
