import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { HtmlView } from '../../components/HtmlView';
import { Badge, Loading, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, spacing } from '../../theme/tokens';
import { github } from './account';
import { timeAgo } from './api';
import { conversationHtml } from './render';

export function IssueScreen() {
  const { owner, repo, number } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();
  const n = Number(number);
  const styles = useStyles();
  const colors = useColors();
  const [commenting, setCommenting] = useState(false);
  const data = useAsync(async () => {
    const gh = github();
    const [issue, comments] = await Promise.all([gh.issue(owner, repo, n), gh.comments(owner, repo, n)]);
    return { issue, comments };
  }, [owner, repo, n]);
  const issue = data.value?.issue;

  const toggleState = async () => {
    if (!issue) return;
    try {
      await github().setIssueState(owner, repo, n, issue.state === 'open' ? 'closed' : 'open');
      haptic('success');
      data.reload();
    } catch (e) {
      Alert.alert('Could not update the issue', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={issue ? issue.title : `#${n}`}
      subtitle={`${owner}/${repo} #${n}`}
      scroll={false}
      testID="github-issue"
      actions={<IconButton icon="external-link" label="Open on GitHub" onPress={() => issue && Linking.openURL(issue.html_url)} />}
    >
      {data.error && <Text variant="error" style={styles.pad}>{data.error}</Text>}
      {!issue ? (
        data.loading && <Loading />
      ) : (
        <>
          <View style={styles.meta}>
            <Badge label={issue.state === 'open' ? 'Open' : 'Closed'} color={issue.state === 'open' ? colors.success : colors.mutedForeground} />
            <Text variant="muted" style={styles.flex} numberOfLines={1}>
              {issue.user.login} opened {timeAgo(issue.created_at)} · {issue.comments} comments
            </Text>
          </View>
          <View style={styles.flex}>
            <HtmlView body={conversationHtml(issue, data.value!.comments)} testID="issue-conversation" />
          </View>
          <View style={styles.bar}>
            <Button title={issue.state === 'open' ? 'Close issue' : 'Reopen'} variant="outline" icon={issue.state === 'open' ? 'check-circle' : 'rotate-ccw'} onPress={toggleState} testID="issue-state" />
            <Button title="Comment" icon="message-square" onPress={() => setCommenting(true)} testID="issue-comment" />
          </View>
        </>
      )}
      <FormSheet
        visible={commenting}
        title="Comment"
        confirmLabel="Comment"
        fields={[{ key: 'body', label: 'Comment', multiline: true, required: true, placeholder: 'Markdown is supported' }]}
        onClose={() => setCommenting(false)}
        onSubmit={async ({ body }) => {
          await github().comment(owner, repo, n, body);
          haptic('success');
          setCommenting(false);
          data.reload();
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  pad: { padding: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
