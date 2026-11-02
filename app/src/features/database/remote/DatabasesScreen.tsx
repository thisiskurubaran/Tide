import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../../components/ActionSheet';
import { Button, IconButton } from '../../../components/Button';
import { FormSheet } from '../../../components/FormSheet';
import { haptic } from '../../../components/haptics';
import { Empty, ListRow, Screen } from '../../../components/Screen';
import { newId, useSsh } from '../../ssh/store';
import { connectionsStore, DbConnection, KIND_LABEL, ServerKind, useConnections } from './connections';
import { serverFields, serverFromForm } from './form';

const KINDS: { kind: ServerKind; label: string }[] = [
  { kind: 'postgres', label: 'PostgreSQL' },
  { kind: 'mysql', label: 'MySQL / MariaDB' },
  { kind: 'redis', label: 'Redis / Valkey' },
  { kind: 'mongo', label: 'MongoDB' },
];

// Saved PostgreSQL, MySQL, Redis and MongoDB servers. Free for everyone.
export function DatabasesScreen() {
  const connections = useConnections((s) => s.connections);
  const hosts = useSsh((s) => s.hosts);
  // Adding asks for the kind of server first, since each asks for different things.
  const [choosing, setChoosing] = useState(false);
  const [editing, setEditing] = useState<{ kind: ServerKind; conn: DbConnection | null } | null>(null);
  const [menu, setMenu] = useState<DbConnection | null>(null);
  const current = editing?.conn ?? null;

  const open = (c: DbConnection) => router.push({ pathname: '/databases/server', params: { id: c.id } });

  return (
    <Screen
      title="Databases"
      subtitle="PostgreSQL, MySQL, Redis and MongoDB"
      testID="databases"
      actions={<IconButton icon="plus" label="Add a database" onPress={() => setChoosing(true)} testID="db-add" />}
    >
      {connections.length === 0 && (
        <Empty
          title="No databases yet"
          body="Add a PostgreSQL, MySQL, Redis or MongoDB server to browse and edit its data, run SQL or commands, directly or through one of your SSH servers. Passwords stay in the Keychain."
        >
          <Button title="Add a database" icon="plus" onPress={() => setChoosing(true)} />
        </Empty>
      )}
      {connections.map((c) => (
        <ListRow
          key={c.id}
          icon="database"
          title={c.name}
          subtitle={`${KIND_LABEL[c.kind]} · ${c.user ? `${c.user}@` : ''}${c.srv || c.host.includes(',') ? c.host : `${c.host}:${c.port}`}${c.database ? `/${c.database}` : ''}`}
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
                { label: 'Edit', icon: 'edit-2', onPress: () => (setMenu(null), setEditing({ kind: menu.kind, conn: menu })) },
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

      <ActionSheet
        title={choosing ? 'Add a database' : null}
        onClose={() => setChoosing(false)}
        actions={KINDS.map((k) => ({ label: k.label, icon: 'database' as const, onPress: () => setEditing({ kind: k.kind, conn: null }) }))}
      />

      <FormSheet
        visible={editing !== null}
        title={current ? `Edit ${current.name}` : `Add ${editing ? KIND_LABEL[editing.kind] : 'a database'}`}
        confirmLabel="Save"
        fields={editing ? serverFields(editing.kind, current, hosts) : []}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const { conn, password } = serverFromForm(editing!.kind, v, current?.id ?? newId(), !!current);
          await connectionsStore.getState().save(conn, password);
          haptic('success');
          setEditing(null);
        }}
      />
    </Screen>
  );
}
