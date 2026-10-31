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
import { spacing } from '../../theme/tokens';
import type { Issue } from '../github/api';
import { conversationHtml } from '../github/render';
import { apiFor } from './accounts';

// An issue on GitLab or Bitbucket: the conversation, comment, close and reopen.
export function HostIssueScreen() {
  const { account, repo, name, n } = useLocalSearchParams<{ account: string; repo: string; name: string; n: string }>();
  const num = Number(n);
  const styles = useStyles();
  const colors = useColors();
  const [commenting, setCommenting] = useState(false);
  const data = useAsync(async () => {
    const host = apiFor(account);
    const [issue, comments] = await Promise.all([host.issue(repo, num), host.issueComments(repo, num)]);
    return { issue, comments };
  }, [account, repo, num]);
  const i = data.value?.issue;

  const toggle = async () => {
    try {
      await apiFor(account).setIssueOpen(repo, num, !i!.open);
      haptic('success');
      data.reload();
    } catch (e) {
      haptic('error');
      Alert.alert('Could not change the issue', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={i ? i.title : `#${num}`}
      subtitle={`${name} #${num}`}
      scroll={false}
      actions={<IconButton icon="external-link" label="Open on the web" onPress={() => i && Linking.openURL(i.webUrl)} />}
      testID="host-issue"
    >
      {data.error && <Text variant="error" style={styles.pad}>{data.error}</Text>}
      {!i ? (
        data.loading && <Loading />
      ) : (
        <>
          <View style={[styles.pad, styles.row]}>
            <Badge label={i.open ? 'Open' : 'Closed'} color={i.open ? colors.success : colors.mutedForeground} />
            <Text variant="muted">opened by {i.author}</Text>
          </View>
          <View style={styles.flex}>
            <HtmlView body={conversationHtml({ user: { login: i.author }, created_at: i.createdAt, body: i.body } as Issue, data.value!.comments)} testID="host-issue-conversation" />
          </View>
          <View style={styles.actions}>
            <Button title={i.open ? 'Close' : 'Reopen'} variant="outline" icon={i.open ? 'check-circle' : 'rotate-ccw'} onPress={toggle} testID="host-issue-toggle" />
            <Button title="Comment" icon="message-square" onPress={() => setCommenting(true)} testID="host-issue-comment" />
          </View>
        </>
      )}
      <FormSheet
        visible={commenting}
        title="Comment"
        confirmLabel="Comment"
        fields={[{ key: 'body', label: 'Comment', multiline: true, required: true, placeholder: 'Markdown works' }]}
        onClose={() => setCommenting(false)}
        onSubmit={async ({ body }) => {
          await apiFor(account).commentOnIssue(repo, num, body);
          haptic('success');
          setCommenting(false);
          data.reload();
        }}
      />
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: { padding: spacing.md },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
