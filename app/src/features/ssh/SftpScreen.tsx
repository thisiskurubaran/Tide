import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { localRunner } from '../../runtime';
import { projectsStore, workspace } from '../../state';
import { formatBytes } from '../editor/largeFiles';
import { RemoteEntry, SftpSession } from './client';
import { connectionConfig, rememberKey, SshHost, useSsh } from './store';

const join = (dir: string, name: string) => (dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`);
const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

// One connection per open files screen, closed when it goes away.
export function useSftp(host: SshHost | undefined) {
  const session = useMemo(() => {
    if (!host) return null;
    const holder: { s: SftpSession | null; ready: Promise<SftpSession> } = { s: null, ready: Promise.resolve(null as never) };
    holder.ready = connectionConfig(host).then((config) => {
      holder.s = new SftpSession(localRunner, config, (fp, which) => rememberKey(host, fp, which));
      return holder.s;
    });
    return holder;
    // Reconnect only when the server itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host?.id]);
  useEffect(() => () => session?.s?.close(), [session]);
  return session;
}

// Browse a server's files over SFTP: folders, text files to edit, and copying into a project.
export function SftpScreen() {
  const { id, path: param } = useLocalSearchParams<{ id: string; path: string }>();
  const host = useSsh((s) => s.hosts.find((h) => h.id === id));
  const sftp = useSftp(host);
  const [path, setPath] = useState<string | null>(param || null);
  const [menu, setMenu] = useState<RemoteEntry | null>(null);
  const [form, setForm] = useState<'mkdir' | 'rename' | 'copy' | null>(null);

  const listing = useAsync(async () => {
    if (!sftp) return null;
    const s = await sftp.ready;
    const dir = path ?? (await s.realpath('.'));
    if (path === null) setPath(dir);
    return { dir, entries: await s.list(dir) };
  }, [sftp, path]);

  const dir = listing.value?.dir ?? path ?? '';
  const act = async (fn: (s: SftpSession) => Promise<unknown>) => {
    try {
      await fn(await sftp!.ready);
      haptic('success');
      listing.reload();
    } catch (e) {
      haptic('error');
      Alert.alert('That didn’t work', e instanceof Error ? e.message : String(e));
    }
  };

  if (!host) return <Screen title="Files"><Text variant="muted">This server was removed.</Text></Screen>;
  return (
    <Screen
      title={dir ? dir.split('/').filter(Boolean).pop() ?? '/' : host.name}
      subtitle={`${host.name} · ${dir}`}
      onRefresh={listing.reload}
      refreshing={listing.loading}
      testID="sftp"
      actions={
        <>
          {dir !== '/' && dir !== '' && <IconButton icon="corner-left-up" label="Up a folder" onPress={() => setPath(parentOf(dir))} testID="sftp-up" />}
          <IconButton icon="folder-plus" label="New folder" onPress={() => setForm('mkdir')} />
        </>
      }
    >
      {listing.error && <Text variant="error" selectable>{listing.error}</Text>}
      {listing.loading && !listing.value && <Loading label={`Connecting to ${host.host}…`} />}
      {listing.value?.entries.length === 0 && <Empty title="Empty folder" />}
      {listing.value?.entries
        .filter((e) => e.name !== '.' && e.name !== '..')
        .map((e) => (
          <ListRow
            key={e.name}
            icon={e.kind === 'dir' ? 'folder' : e.kind === 'link' ? 'link' : 'file'}
            title={e.name}
            subtitle={e.kind === 'dir' ? undefined : formatBytes(e.size)}
            onPress={() =>
              e.kind === 'dir' ? setPath(join(dir, e.name)) : router.push({ pathname: '/ssh/edit', params: { id: host.id, path: join(dir, e.name) } })
            }
            right={<IconButton icon="more-horizontal" label={`Actions for ${e.name}`} onPress={() => setMenu(e)} />}
          />
        ))}
      <ActionSheet
        title={menu?.name ?? null}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                ...(menu.kind !== 'dir' ? [{ label: 'Copy to a project', icon: 'download' as const, onPress: () => setForm('copy') }] : []),
                { label: 'Rename', icon: 'edit-2', onPress: () => setForm('rename') },
                {
                  label: 'Delete',
                  icon: 'trash-2',
                  destructive: true,
                  onPress: () =>
                    Alert.alert(`Delete ${menu.name} on ${host.name}?`, menu.kind === 'dir' ? 'Only empty folders can be deleted.' : 'This can’t be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => act((s) => s.remove(join(dir, menu.name))) },
                    ]),
                },
              ]
            : []
        }
      />
      <FormSheet
        visible={form === 'mkdir'}
        title="New folder"
        confirmLabel="Create"
        fields={[{ key: 'name', label: 'Name', required: true, mono: true }]}
        onClose={() => setForm(null)}
        onSubmit={async ({ name }) => {
          await (await sftp!.ready).mkdir(join(dir, name.trim()));
          setForm(null);
          listing.reload();
        }}
      />
      <FormSheet
        visible={form === 'rename' && !!menu}
        title={`Rename ${menu?.name ?? ''}`}
        confirmLabel="Rename"
        fields={[{ key: 'name', label: 'New name', initial: menu?.name, required: true, mono: true }]}
        onClose={() => setForm(null)}
        onSubmit={async ({ name }) => {
          await (await sftp!.ready).rename(join(dir, menu!.name), join(dir, name.trim()));
          setForm(null);
          listing.reload();
        }}
      />
      <FormSheet
        visible={form === 'copy' && !!menu}
        title={`Copy ${menu?.name ?? ''} to a project`}
        confirmLabel="Copy"
        fields={[
          { key: 'project', label: 'Project', choices: projectsStore.getState().projects.map((p) => ({ value: p, label: p })), required: true },
          { key: 'path', label: 'Save as', initial: menu?.name, mono: true, required: true },
        ]}
        onClose={() => setForm(null)}
        onSubmit={async ({ project, path: to }) => {
          const { base64 } = await (await sftp!.ready).read(join(dir, menu!.name));
          await workspace.writeBase64(project, to.trim(), base64);
          await projectsStore.getState().loadTree(project);
          haptic('success');
          setForm(null);
        }}
      />
    </Screen>
  );
}
