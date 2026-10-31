import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import { cloneRepo } from '../git/clone';
import { timeAgo } from '../github/api';
import { projectHref } from '../projects/href';
import type { ChangeState } from './api';
import { apiFor, HOST_LABEL, useAccounts } from './accounts';

type Tab = 'changes' | 'issues';

// One repository: its merge (or pull) requests and issues, and Clone.
export function HostRepoScreen() {
  const { account, repo, name, clone, web } = useLocalSearchParams<{ account: string; repo: string; name: string; clone: string; web: string }>();
  const colors = useColors();
  const a = useAccounts((s) => s.accounts.find((x) => x.id === account));
  const [tab, setTab] = useState<Tab>('changes');
  const [state, setState] = useState<ChangeState>('open');
  const [cloning, setCloning] = useState(false);
  const [creating, setCreating] = useState(false);
  const changeWord = a?.kind === 'gitlab' ? 'Merge requests' : 'Pull requests';

  const list = useAsync(async () => {
    const host = apiFor(account);
    if (tab === 'changes') return { kind: 'changes' as const, items: await host.changes(repo, state) };
    return { kind: 'issues' as const, items: await host.issues(repo, state === 'open') };
  }, [account, repo, tab, state]);

  const doClone = async () => {
    setCloning(true);
    try {
      const project = await cloneRepo(name.split('/').pop() ?? name, clone);
      haptic('success');
      router.push(projectHref(project));
    } catch (e) {
      haptic('error');
      Alert.alert('Clone failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  };

  return (
    <Screen
      title={name}
      subtitle={a ? HOST_LABEL[a.kind] : undefined}
      onRefresh={list.reload}
      refreshing={list.loading && !!list.value}
      actions={<IconButton icon="external-link" label={`Open on ${a ? HOST_LABEL[a.kind] : 'the web'}`} onPress={() => Linking.openURL(web)} />}
      testID="host-repo"
    >
      <Button title={cloning ? 'Cloning…' : 'Clone into a project'} icon="download" onPress={doClone} disabled={cloning} testID="host-clone" />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'changes', label: changeWord },
          { value: 'issues', label: 'Issues' },
        ]}
        testID="host-tab"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Segmented<ChangeState>
            value={state === 'merged' && tab === 'issues' ? 'closed' : state}
            onChange={setState}
            options={
              tab === 'changes'
                ? [
                    { value: 'open', label: 'Open' },
                    { value: 'merged', label: 'Merged' },
                    { value: 'closed', label: 'Closed' },
                  ]
                : [
                    { value: 'open', label: 'Open' },
                    { value: 'closed', label: 'Closed' },
                  ]
            }
            testID="host-state"
          />
        </View>
        {tab === 'issues' && <IconButton icon="plus" label="New issue" onPress={() => setCreating(true)} testID="host-new-issue" />}
      </View>
      {list.error && <Text variant="error">{list.error}</Text>}
      {list.loading && !list.value && <Loading />}
      {list.value?.kind === 'issues' && list.value.items === null && <Empty title="No issue tracker" body="Issues are turned off for this repository." />}
      {list.value?.items?.length === 0 && <Empty title={`Nothing ${state}`} />}
      {list.value?.kind === 'changes' &&
        list.value.items.map((c) => (
          <ListRow
            key={c.number}
            icon="git-pull-request"
            iconColor={c.state === 'open' ? colors.success : c.state === 'merged' ? colors.brand : colors.mutedForeground}
            title={`${c.draft ? 'Draft: ' : ''}${c.title}`}
            subtitle={`#${c.number} · ${c.source} → ${c.target}`}
            detail={`${c.author} · ${timeAgo(c.createdAt)}`}
            onPress={() => router.push({ pathname: '/hosts/change', params: { account, repo, name, n: String(c.number) } })}
            testID={`host-change-${c.number}`}
          />
        ))}
      {list.value?.kind === 'issues' &&
        list.value.items?.map((i) => (
          <ListRow
            key={i.number}
            icon={i.open ? 'alert-circle' : 'check-circle'}
            iconColor={i.open ? colors.success : colors.mutedForeground}
            title={i.title}
            subtitle={`#${i.number} · ${i.author}`}
            detail={`${timeAgo(i.createdAt)}${i.comments ? ` · ${i.comments} comments` : ''}`}
            onPress={() => router.push({ pathname: '/hosts/issue', params: { account, repo, name, n: String(i.number) } })}
            testID={`host-issue-${i.number}`}
          />
        ))}
      <FormSheet
        visible={creating}
        title="New issue"
        confirmLabel="Create"
        fields={[
          { key: 'title', label: 'Title', required: true },
          { key: 'body', label: 'Description', multiline: true, placeholder: 'Markdown works' },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={async ({ title, body }) => {
          const issue = await apiFor(account).createIssue(repo, title.trim(), body);
          haptic('success');
          setCreating(false);
          router.push({ pathname: '/hosts/issue', params: { account, repo, name, n: String(issue.number) } });
        }}
      />
    </Screen>
  );
}
