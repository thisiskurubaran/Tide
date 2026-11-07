import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { startForward } from './client';
import { connectionConfig, forwardsStore, newId, rememberKey, SshHost, sshStore, useForwards, useSsh } from './store';

// Saved servers: open a terminal or browse files over SFTP. Free for everyone.
export function SshHome() {
  const hosts = useSsh((s) => s.hosts);
  const keys = useSsh((s) => s.keys);
  const [editing, setEditing] = useState<SshHost | 'new' | null>(null);
  const [menu, setMenu] = useState<SshHost | null>(null);
  const [forwarding, setForwarding] = useState<SshHost | null>(null);
  const forwards = useForwards();

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
      {forwards.length > 0 && <Text variant="label">Forwarded ports</Text>}
      {forwards.map((f) => (
        <ListRow
          key={f.id}
          icon="shuffle"
          title={`localhost:${f.localPort} → ${f.remoteHost}:${f.remotePort}`}
          subtitle={`${hosts.find((h) => h.id === f.hostId)?.name ?? ''} · ${f.status}`}
          right={
            <>
              <IconButton
                icon="eye"
                label="Open in preview"
                onPress={() => router.push({ pathname: '/preview', params: { url: `http://127.0.0.1:${f.localPort}/`, port: String(f.localPort) } })}
              />
              <IconButton icon="x-circle" label="Stop forwarding" onPress={f.stop} />
            </>
          }
        />
      ))}
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
                { label: 'Forward a port…', icon: 'shuffle', onPress: () => setForwarding(menu) },
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
          ...(hosts.filter((h) => h.id !== current?.id).length
            ? [
                {
                  key: 'jump',
                  label: 'Connect through',
                  initial: current?.jumpId ?? '',
                  choices: [{ value: '', label: 'Directly' }, ...hosts.filter((h) => h.id !== current?.id).map((h) => ({ value: h.id, label: h.name }))],
                  hint: 'A jump host (bastion) to reach this server through.',
                },
              ]
            : []),
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
            jumpId: v.jump || undefined,
            // A new address is a different server; its key gets checked afresh.
            fingerprint: current && current.host === v.host.trim() && current.port === port ? current.fingerprint : undefined,
          };
          await sshStore.getState().saveHost(host, v.password ? v.password : current ? undefined : '');
          haptic('success');
          setEditing(null);
        }}
      />
      <FormSheet
        visible={forwarding !== null}
        title={`Forward a port from ${forwarding?.name ?? ''}`}
        description="A server port, such as a dev server, opens on this device's localhost and in Tide's preview."
        confirmLabel="Start"
        fields={[
          { key: 'remotePort', label: 'Port on the server', placeholder: '3000', keyboardType: 'number-pad', mono: true, required: true },
          { key: 'remoteHost', label: 'Host, as the server sees it', initial: 'localhost', mono: true, keyboardType: 'url' },
          { key: 'localPort', label: 'Port on this device', placeholder: 'Same as the server', keyboardType: 'number-pad', mono: true },
        ]}
        onClose={() => setForwarding(null)}
        onSubmit={async (v) => {
          const host = forwarding!;
          const remotePort = Number(v.remotePort);
          const localPort = Number(v.localPort || v.remotePort);
          const valid = (p: number) => Number.isInteger(p) && p > 0 && p < 65536;
          if (!valid(remotePort) || !valid(localPort)) throw new Error('Ports are numbers from 1 to 65535.');
          if (localPort < 1024) throw new Error('Use a port on this device from 1024 up.');
          if (forwardsStore.getState().forwards.some((f) => f.localPort === localPort)) throw new Error(`Port ${localPort} is already forwarded.`);
          const id = newId();
          const update = (patch: { status?: string }) =>
            forwardsStore.setState((s) => ({ forwards: s.forwards.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
          const stop = startForward(localRunner, await connectionConfig(host), { localPort, remoteHost: v.remoteHost.trim() || 'localhost', remotePort }, {
            status: (text) => update({ status: text.startsWith('Forwarding') ? 'Forwarding' : text }),
            hostKey: (fp, which) => rememberKey(host, fp, which),
            exit: (error) => {
              forwardsStore.setState((s) => ({ forwards: s.forwards.filter((f) => f.id !== id) }));
              if (error) Alert.alert('Forwarding stopped', error);
            },
          });
          forwardsStore.setState((s) => ({
            forwards: [...s.forwards, { id, hostId: host.id, localPort, remoteHost: v.remoteHost.trim() || 'localhost', remotePort, status: 'Connecting…', stop }],
          }));
          haptic('success');
          setForwarding(null);
        }}
      />
    </Screen>
  );
}
