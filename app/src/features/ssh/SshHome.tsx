import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { newId, SshHost, sshStore, useSsh } from './store';

// Saved servers: open a terminal or browse files over SFTP. Free for everyone.
export function SshHome() {
  const hosts = useSsh((s) => s.hosts);
  const keys = useSsh((s) => s.keys);
  const [editing, setEditing] = useState<SshHost | 'new' | null>(null);
  const [menu, setMenu] = useState<SshHost | null>(null);

  const current = editing === 'new' ? null : editing;
  return (
    <Screen
      title="SSH"
      subtitle="Your servers"
      testID="ssh"
      actions={
        <>
          <IconButton icon="key" label="Keys" onPress={() => router.push('/ssh/keys')} testID="ssh-keys" />
          <IconButton icon="plus" label="Add a server" onPress={() => setEditing('new')} testID="ssh-add" />
        </>
      }
    >
      {hosts.length === 0 && (
        <Empty title="No servers yet" body="Add a server to open a terminal on it or browse its files over SFTP. Passwords and keys stay in the Keychain.">
          <Button title="Add a server" icon="plus" onPress={() => setEditing('new')} />
        </Empty>
      )}
      {hosts.map((h) => (
        <ListRow
          key={h.id}
          icon="server"
          title={h.name}
          subtitle={`${h.username}@${h.host}${h.port === 22 ? '' : `:${h.port}`}`}
          detail={h.auth === 'key' ? `Key: ${keys.find((k) => k.id === h.keyId)?.name ?? 'missing'}` : 'Password'}
          onPress={() => setMenu(h)}
          testID={`ssh-host-${h.name}`}
        />
      ))}
      {hosts.length > 0 && <Text variant="muted">Tap a server to open a terminal or its files.</Text>}

      <ActionSheet
        title={menu?.name ?? null}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                { label: 'Terminal', icon: 'terminal', onPress: () => router.push({ pathname: '/ssh/terminal', params: { id: menu.id } }) },
                { label: 'Files (SFTP)', icon: 'folder', onPress: () => router.push({ pathname: '/ssh/files', params: { id: menu.id, path: '' } }) },
                { label: 'Edit', icon: 'edit-2', onPress: () => setEditing(menu) },
                ...(menu.fingerprint
                  ? [{ label: 'Forget host key', icon: 'shield-off' as const, onPress: () => sshStore.getState().trustHost(menu.id, undefined).then(() => haptic('success')) }]
                  : []),
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: () =>
                    Alert.alert(`Delete ${menu.name}?`, 'Its saved password goes too.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => sshStore.getState().removeHost(menu.id) },
                    ]),
                },
              ]
            : []
        }
      />

      <FormSheet
        visible={editing !== null}
        title={current ? `Edit ${current.name}` : 'Add a server'}
        confirmLabel="Save"
        fields={[
          { key: 'host', label: 'Host', initial: current?.host, placeholder: 'example.com or 192.168.1.10', mono: true, keyboardType: 'url', required: true },
          { key: 'username', label: 'Username', initial: current?.username, placeholder: 'root', mono: true, required: true },
          { key: 'port', label: 'Port', initial: String(current?.port ?? 22), mono: true, keyboardType: 'number-pad' },
          { key: 'name', label: 'Name (optional)', initial: current?.name, placeholder: 'Shown in the list' },
          {
            key: 'auth',
            label: 'Sign in with',
            initial: current?.auth === 'key' && current.keyId ? `key:${current.keyId}` : !current && keys.length ? `key:${keys[0].id}` : 'password',
            choices: [
              { value: 'password', label: 'Password' },
              ...keys.map((k) => ({ value: `key:${k.id}`, label: `Key: ${k.name}` })),
            ],
          },
          { key: 'password', label: 'Password', secure: true, placeholder: current ? 'Unchanged' : 'Only for password sign-in', hint: keys.length ? undefined : 'To use a key instead, create or import one under Keys first.' },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const port = Number(v.port || 22);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port must be a number from 1 to 65535.');
          const usesKey = v.auth.startsWith('key:');
          const keyId = usesKey ? v.auth.slice(4) : undefined;
          const host: SshHost = {
            id: current?.id ?? newId(),
            name: v.name.trim() || v.host.trim(),
            host: v.host.trim(),
            port,
            username: v.username.trim(),
            auth: usesKey ? 'key' : 'password',
            keyId,
            // A new address is a different server; its key gets checked afresh.
            fingerprint: current && current.host === v.host.trim() && current.port === port ? current.fingerprint : undefined,
          };
          await sshStore.getState().saveHost(host, v.password ? v.password : current ? undefined : '');
          haptic('success');
          setEditing(null);
        }}
      />
    </Screen>
  );
}
