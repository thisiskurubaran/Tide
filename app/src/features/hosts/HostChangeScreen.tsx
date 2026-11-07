import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { HtmlView } from '../../components/HtmlView';
import { Badge, Loading, Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, spacing } from '../../theme/tokens';
import type { Issue } from '../github/api';
import { DiffList } from '../github/DiffList';
import { conversationHtml } from '../github/render';
import { apiFor, useAccounts } from './accounts';

type Tab = 'conversation' | 'files';

// A GitLab merge request or Bitbucket pull request: the conversation, the
// changed files, and comment, approve and merge.
export function HostChangeScreen() {
  const { account, repo, name, n } = useLocalSearchParams<{ account: string; repo: string; name: string; n: string }>();
  const num = Number(n);
  const styles = useStyles();
  const colors = useColors();
  const kind = useAccounts((s) => s.accounts.find((x) => x.id === account)?.kind);
  const word = kind === 'gitlab' ? 'merge request' : 'pull request';
  const [tab, setTab] = useState<Tab>('conversation');
  const [commenting, setCommenting] = useState(false);

  const data = useAsync(async () => {
    const host = apiFor(account);
    const [change, comments] = await Promise.all([host.change(repo, num), host.changeComments(repo, num)]);
    return { change, comments };
  }, [account, repo, num]);
  const files = useAsync(() => (tab === 'files' ? apiFor(account).changeFiles(repo, num) : Promise.resolve(null)), [tab, account, repo, num]);

  const c = data.value?.change;
  const stateLabel = c ? (c.state === 'merged' ? 'Merged' : c.state === 'open' ? (c.draft ? 'Draft' : 'Open') : 'Closed') : '';
  const stateColor = c?.state === 'merged' ? colors.brand : c?.state === 'open' ? colors.success : colors.mutedForeground;

  const act = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
      haptic('success');
      data.reload();
    } catch (e) {
      haptic('error');
      Alert.alert(`${label} failed`, e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen
      title={c ? c.title : `#${num}`}
      subtitle={`${name} #${num}`}
      scroll={false}
      actions={<IconButton icon="external-link" label="Open on the web" onPress={() => c && Linking.openURL(c.webUrl)} />}
      testID="host-change"
    >
      {data.error && <Text variant="error" style={styles.pad}>{data.error}</Text>}
      {!c ? (
        data.loading && <Loading />
      ) : (
        <>
          <View style={styles.meta}>
            <View style={styles.row}>
              <Badge label={stateLabel} color={stateColor} />
              <Text variant="muted" style={styles.flex} numberOfLines={2}>
                {c.author} wants to merge <Text variant="mono">{c.source}</Text> into <Text variant="mono">{c.target}</Text>
              </Text>
            </View>
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'conversation', label: 'Conversation' },
                { value: 'files', label: 'Files' },
              ]}
              testID="host-change-tab"
            />
          </View>
          <View style={styles.flex}>
            {tab === 'conversation' && (
              <HtmlView body={conversationHtml({ user: { login: c.author }, created_at: c.createdAt, body: c.body } as Issue, data.value!.comments)} testID="host-change-conversation" />
            )}
            {tab === 'files' &&
              (files.value ? <DiffList files={files.value} /> : files.error ? <Text variant="error" style={styles.pad}>{files.error}</Text> : <Loading />)}
          </View>
          <View style={styles.actions}>
            <Button title="Comment" variant="outline" icon="message-square" onPress={() => setCommenting(true)} testID="host-comment" />
            {c.state === 'open' && (
              <>
                <Button title="Approve" variant="outline" icon="check" onPress={() => act('Approve', () => apiFor(account).approve(repo, num))} testID="host-approve" />
                <Button
                  title="Merge"
                  icon="git-merge"
                  onPress={() =>
                    Alert.alert(`Merge this ${word}?`, `${c.source} goes into ${c.target}.`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Merge', onPress: () => act('Merge', () => apiFor(account).merge(repo, num)) },
                    ])
                  }
                  testID="host-merge"
                />
              </>
            )}
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
          await apiFor(account).commentOnChange(repo, num, body);
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
  meta: { gap: spacing.sm, padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
}));
