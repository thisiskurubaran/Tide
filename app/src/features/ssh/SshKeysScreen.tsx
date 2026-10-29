import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { runSshTool } from './client';
import { newId, sshStore, useSsh } from './store';

// SSH keys: generate an ed25519 key or import one, and copy the public key to servers.
export function SshKeysScreen() {
  const keys = useSsh((s) => s.keys);
  const [form, setForm] = useState<'generate' | 'import' | null>(null);
  const copy = (publicKey: string) => Clipboard.setStringAsync(publicKey).then(() => haptic('success'));

  return (
    <Screen title="SSH keys" testID="ssh-keys-screen" actions={<IconButton icon="plus" label="Generate a key" onPress={() => setForm('generate')} />}>
      <Text variant="muted">
        Private keys stay in the Keychain and never leave the device. Add a key's public half to the server's ~/.ssh/authorized_keys, or paste it
        into GitHub or your host's settings.
      </Text>
      {keys.length === 0 && <Empty title="No keys yet" body="Generate a new ed25519 key, or import one you already use." />}
      {keys.map((k) => (
        <ListRow
          key={k.id}
          icon="key"
          title={k.name}
          subtitle={`${k.publicKey.slice(0, 48)}…`}
          right={
            <>
              <IconButton icon="copy" label={`Copy the public key of ${k.name}`} onPress={() => copy(k.publicKey)} />
              <IconButton
                icon="trash-2"
                label={`Delete ${k.name}`}
                onPress={() =>
                  Alert.alert(`Delete ${k.name}?`, 'Servers that use it will need another key or a password.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => sshStore.getState().removeKey(k.id) },
                  ])
                }
              />
            </>
          }
        />
      ))}
      <Button title="Generate an ed25519 key" icon="plus" onPress={() => setForm('generate')} testID="ssh-generate" />
      <Button title="Import a private key" variant="outline" icon="download" onPress={() => setForm('import')} testID="ssh-import" />

      <FormSheet
        visible={form === 'generate'}
        title="Generate a key"
        confirmLabel="Generate"
        fields={[{ key: 'name', label: 'Name', initial: 'iPhone', required: true, hint: 'Shown in the list and added as the key’s comment.' }]}
        onClose={() => setForm(null)}
        onSubmit={async ({ name }) => {
          const keys = JSON.parse(await runSshTool(localRunner, 'keygen', { comment: `${name.trim()}@tide` }));
          await sshStore.getState().addKey({ id: newId(), name: name.trim(), publicKey: keys.publicKey }, keys.privateKey);
          await copy(keys.publicKey);
          setForm(null);
          Alert.alert('Key created', 'Its public key is copied. Add it to the server’s ~/.ssh/authorized_keys.');
        }}
      />
      <FormSheet
        visible={form === 'import'}
        title="Import a private key"
        description="OpenSSH or PEM format: ed25519, ECDSA or RSA."
        confirmLabel="Import"
        fields={[
          { key: 'name', label: 'Name', required: true },
          { key: 'privateKey', label: 'Private key', multiline: true, mono: true, required: true, placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----' },
          { key: 'passphrase', label: 'Passphrase', secure: true, placeholder: 'If the key has one' },
        ]}
        onClose={() => setForm(null)}
        onSubmit={async ({ name, privateKey, passphrase }) => {
          const pem = privateKey.trim().endsWith('\n') ? privateKey.trim() : `${privateKey.trim()}\n`;
          const { publicKey } = JSON.parse(await runSshTool(localRunner, 'pubkey', { privateKey: pem, passphrase }));
          await sshStore.getState().addKey({ id: newId(), name: name.trim(), publicKey }, pem, passphrase || undefined);
          haptic('success');
          setForm(null);
        }}
      />
    </Screen>
  );
}
