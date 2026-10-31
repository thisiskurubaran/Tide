import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../../components/ActionSheet';
import { Button, IconButton } from '../../../components/Button';
import { FormSheet } from '../../../components/FormSheet';
import { haptic } from '../../../components/haptics';
import { Empty, ListRow, Screen } from '../../../components/Screen';
import { newId, useSsh } from '../../ssh/store';
import { connectionsStore, DbConnection, DEFAULT_PORT, KIND_LABEL, useConnections } from './connections';
import type { ServerKind } from './dialect';

// Saved PostgreSQL and MySQL servers, opened in the database viewer. Free for everyone.
export function DatabasesScreen() {
  const connections = useConnections((s) => s.connections);
  const hosts = useSsh((s) => s.hosts);
  const [editing, setEditing] = useState<DbConnection | 'new' | null>(null);
  const [menu, setMenu] = useState<DbConnection | null>(null);
  const current = editing === 'new' ? null : editing;

  const open = (c: DbConnection) => router.push({ pathname: '/databases/server', params: { id: c.id } });

  return (
    <Screen
      title="Databases"
      subtitle="PostgreSQL and MySQL"
      testID="databases"
      actions={<IconButton icon="plus" label="Add a database" onPress={() => setEditing('new')} testID="db-add" />}
    >
      {connections.length === 0 && (
        <Empty
          title="No databases yet"
          body="Add a PostgreSQL or MySQL server to browse its tables, edit rows and run SQL, directly or through one of your SSH servers. Passwords stay in the Keychain."
        >
          <Button title="Add a database" icon="plus" onPress={() => setEditing('new')} />
        </Empty>
      )}
      {connections.map((c) => (
        <ListRow
          key={c.id}
          icon="database"
          title={c.name}
          subtitle={`${KIND_LABEL[c.kind]} · ${c.user}@${c.host}:${c.port}${c.database ? `/${c.database}` : ''}`}
          detail={c.sshHostId ? `Through ${hosts.find((h) => h.id === c.sshHostId)?.name ?? 'a removed SSH server'}` : c.ssl === 'off' ? undefined : `SSL: ${c.ssl}`}
          onPress={() => setMenu(c)}
          testID={`db-${c.name}`}
        />
      ))}

      <ActionSheet
        title={menu?.name ?? null}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                { label: 'Open', icon: 'database', onPress: () => (setMenu(null), open(menu)) },
                { label: 'Edit', icon: 'edit-2', onPress: () => (setMenu(null), setEditing(menu)) },
                {
                  label: 'Remove',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: () => {
                    const c = menu;
                    setMenu(null);
                    Alert.alert(`Remove ${c.name}?`, 'Its saved password is deleted too. Nothing changes on the server.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => connectionsStore.getState().remove(c.id) },
                    ]);
                  },
                },
              ]
            : []
        }
      />

      <FormSheet
        visible={editing !== null}
        title={current ? `Edit ${current.name}` : 'Add a database'}
        confirmLabel="Save"
        fields={[
          {
            key: 'kind',
            label: 'Server',
            choices: [
              { value: 'postgres', label: 'PostgreSQL' },
              { value: 'mysql', label: 'MySQL / MariaDB' },
            ],
            initial: current?.kind ?? 'postgres',
          },
          { key: 'name', label: 'Name', placeholder: 'Production', initial: current?.name ?? '' },
          { key: 'host', label: 'Host', mono: true, required: true, keyboardType: 'url', placeholder: 'db.example.com', initial: current?.host ?? '' },
          { key: 'port', label: 'Port', mono: true, keyboardType: 'number-pad', placeholder: '5432 or 3306', initial: current ? String(current.port) : '' },
          { key: 'user', label: 'User', mono: true, required: true, initial: current?.user ?? '' },
          { key: 'password', label: 'Password', secure: true, placeholder: current ? 'Unchanged' : '', initial: '' },
          { key: 'database', label: 'Database', mono: true, placeholder: 'Optional', initial: current?.database ?? '' },
          {
            key: 'ssl',
            label: 'SSL',
            choices: [
              { value: 'off', label: 'Off' },
              { value: 'require', label: 'Require' },
              { value: 'verify', label: 'Verify' },
            ],
            initial: current?.ssl ?? 'off',
            hint: 'Require encrypts without checking the certificate; Verify also checks it. Hosted databases usually need one of them.',
          },
          {
            key: 'ssh',
            label: 'Connect through',
            choices: [{ value: '', label: 'Directly' }, ...hosts.map((h) => ({ value: h.id, label: h.name }))],
            initial: current?.sshHostId ?? '',
            hint: hosts.length ? 'Through SSH, the host is as that server sees it, often localhost.' : 'Add SSH servers in SSH to reach databases that are only open on their server.',
          },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const kind = v.kind as ServerKind;
          const port = v.port.trim() ? Number(v.port) : DEFAULT_PORT[kind];
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port is a number from 1 to 65535.');
          const conn: DbConnection = {
            id: current?.id ?? newId(),
            name: v.name.trim() || v.database.trim() || v.host.trim(),
            kind,
            host: v.host.trim(),
            port,
            user: v.user.trim(),
            database: v.database.trim(),
            ssl: v.ssl as DbConnection['ssl'],
            ...(v.ssh ? { sshHostId: v.ssh } : {}),
          };
          // An empty password field keeps the saved one when editing.
          await connectionsStore.getState().save(conn, v.password || (current ? undefined : ''));
          haptic('success');
          setEditing(null);
        }}
      />
    </Screen>
  );
}
