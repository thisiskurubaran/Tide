import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Screen } from '../../components/Screen';
import type { HostKind } from './api';
import { accountsStore, HOST_LABEL, useAccounts } from './accounts';

// GitLab and Bitbucket accounts. Tide Pro (the entry points check).
export function HostsScreen() {
  const accounts = useAccounts((s) => s.accounts);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState<HostKind | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const account = accounts.find((a) => a.id === menu);

  return (
    <Screen title="GitLab and Bitbucket" subtitle="Your accounts" actions={<IconButton icon="plus" label="Add an account" onPress={() => setPicking(true)} testID="hosts-add" />} testID="hosts">
      {accounts.length === 0 && (
        <Empty title="No accounts yet" body="Sign in with a token to browse your repositories, clone them, review merge and pull requests, and work on issues. Tokens stay in the Keychain.">
          <Button title="Add GitLab" icon="plus" onPress={() => setAdding('gitlab')} testID="hosts-add-gitlab" />
          <Button title="Add Bitbucket" variant="outline" icon="plus" onPress={() => setAdding('bitbucket')} testID="hosts-add-bitbucket" />
        </Empty>
      )}
      {accounts.map((a) => (
        <ListRow
          key={a.id}
          icon={a.kind === 'gitlab' ? 'gitlab' : 'git-branch'}
          title={`${a.name} (${a.username})`}
          subtitle={a.kind === 'gitlab' ? `GitLab · ${a.baseUrl.replace(/^https:\/\//, '')}` : 'Bitbucket'}
          onPress={() => router.push({ pathname: '/hosts/repos', params: { account: a.id } })}
          right={<IconButton icon="more-horizontal" label={`Actions for ${a.username}`} onPress={() => setMenu(a.id)} />}
          testID={`host-${a.username}`}
        />
      ))}

      <ActionSheet
        title={picking ? 'Add an account' : null}
        onClose={() => setPicking(false)}
        actions={[
          { label: 'GitLab', icon: 'gitlab', onPress: () => (setPicking(false), setAdding('gitlab')) },
          { label: 'Bitbucket', icon: 'git-branch', onPress: () => (setPicking(false), setAdding('bitbucket')) },
        ]}
      />
      <ActionSheet
        title={account ? `${HOST_LABEL[account.kind]}: ${account.username}` : null}
        onClose={() => setMenu(null)}
        actions={[
          {
            label: 'Sign out',
            icon: 'log-out',
            destructive: true,
            onPress: () => {
              const a = account!;
              setMenu(null);
              Alert.alert(`Sign out of ${a.username}?`, 'The token is deleted from this device. Projects you cloned stay.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => accountsStore.getState().remove(a.id) },
              ]);
            },
          },
        ]}
      />
      <FormSheet
        visible={adding !== null}
        title={adding === 'gitlab' ? 'Add GitLab' : 'Add Bitbucket'}
        description={
          adding === 'gitlab'
            ? 'Create a personal access token in GitLab under Preferences → Access tokens, with the api scope (read_api to only look).'
            : 'Create an API token at id.atlassian.com → Security → API tokens, with Bitbucket scopes for repositories, pull requests and issues (read and write).'
        }
        confirmLabel="Sign in"
        fields={
          adding === 'gitlab'
            ? [
                { key: 'url', label: 'GitLab address', mono: true, keyboardType: 'url', initial: 'https://gitlab.com', hint: 'Change it for your own GitLab.' },
                { key: 'token', label: 'Personal access token', mono: true, secure: true, required: true },
              ]
            : [
                { key: 'email', label: 'Atlassian account email', keyboardType: 'email-address', required: true },
                { key: 'token', label: 'API token', mono: true, secure: true, required: true },
              ]
        }
        onClose={() => setAdding(null)}
        onSubmit={async (v) => {
          const a = await accountsStore.getState().add({ kind: adding!, baseUrl: v.url ?? '', ...(v.email ? { email: v.email.trim() } : {}) }, v.token);
          haptic('success');
          setAdding(null);
          router.push({ pathname: '/hosts/repos', params: { account: a.id } });
        }}
      />
    </Screen>
  );
}
