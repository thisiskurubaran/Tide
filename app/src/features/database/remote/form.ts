// The add / edit server form: which fields each kind of server asks for, and
// the saved connection (plus password, for the Keychain) its values make.
import type { FormField } from '../../../components/FormSheet';
import type { SshHost } from '../../ssh/store';
import { DbConnection, DEFAULT_PORT, ServerKind } from './connections';
import { parseMongoUri } from './mongo';

export function serverFields(kind: ServerKind, current: DbConnection | null, hosts: Pick<SshHost, 'id' | 'name'>[]): FormField[] {
  const sql = kind === 'postgres' || kind === 'mysql';
  const mongo = kind === 'mongo';
  return [
    { key: 'name', label: 'Name', placeholder: 'Production', initial: current?.name ?? '' },
    mongo
      ? {
          key: 'host',
          label: 'Host or connection string',
          mono: true,
          required: true,
          keyboardType: 'url',
          placeholder: 'db.example.com or mongodb+srv://…',
          initial: current ? (current.srv ? `mongodb+srv://${current.host}` : current.host) : '',
          hint: 'A pasted connection string fills in the rest; its password goes to the Keychain.',
        }
      : { key: 'host', label: 'Host', mono: true, required: true, keyboardType: 'url', placeholder: 'db.example.com', initial: current?.host ?? '' },
    { key: 'port', label: 'Port', mono: true, keyboardType: 'number-pad', placeholder: String(DEFAULT_PORT[kind]), initial: current ? String(current.port) : '' },
    { key: 'user', label: 'User', mono: true, required: sql, placeholder: sql ? '' : kind === 'redis' ? 'Optional, for Redis 6 ACL users' : 'Optional', initial: current?.user ?? '' },
    { key: 'password', label: 'Password', secure: true, placeholder: current ? 'Unchanged' : sql ? '' : 'Optional', initial: '' },
    kind === 'redis'
      ? { key: 'database', label: 'Database number', mono: true, keyboardType: 'number-pad', placeholder: '0', initial: current?.database ?? '' }
      : { key: 'database', label: 'Database', mono: true, placeholder: 'Optional', initial: current?.database ?? '', hint: mongo ? 'Opened first, and the one users are checked against unless options say authSource.' : undefined },
    ...(mongo ? [{ key: 'options', label: 'Options', mono: true, placeholder: 'authSource=admin&replicaSet=rs0', initial: current?.options ?? '' }] : []),
    {
      key: 'ssl',
      label: sql ? 'SSL' : 'TLS',
      choices: [
        { value: 'off', label: 'Off' },
        { value: 'require', label: 'Require' },
        { value: 'verify', label: 'Verify' },
      ],
      initial: current?.ssl ?? 'off',
      hint: mongo
        ? 'Require encrypts without checking the certificate; Verify also checks it. Off leaves it to the connection string: mongodb+srv uses TLS anyway.'
        : 'Require encrypts without checking the certificate; Verify also checks it. Hosted databases usually need one of them.',
    },
    {
      key: 'ssh',
      label: 'Connect through',
      choices: [{ value: '', label: 'Directly' }, ...hosts.map((h) => ({ value: h.id, label: h.name }))],
      initial: current?.sshHostId ?? '',
      hint: hosts.length ? 'Through SSH, the host is as that server sees it, often localhost.' : 'Add SSH servers in SSH to reach databases that are only open on their server.',
    },
  ];
}

// `password` is undefined when the form leaves the saved one as it is.
export function serverFromForm(kind: ServerKind, v: Record<string, string>, id: string, editing: boolean): { conn: DbConnection; password: string | undefined } {
  let host = v.host.trim();
  let portText = v.port.trim();
  let user = v.user.trim();
  let password = v.password;
  let database = v.database.trim();
  let options = (v.options ?? '').trim().replace(/^\?/, '');
  let srv = false;

  if (kind === 'mongo') {
    const uri = /^mongodb(\+srv)?:\/\//.test(host) ? parseMongoUri(host) : null;
    if (/^mongodb(\+srv)?:\/\//.test(host) && !uri) throw new Error('That connection string isn’t one MongoDB reads, like mongodb://host:27017/db.');
    if (uri) {
      host = uri.hosts;
      srv = uri.srv;
      user = user || uri.user;
      password = password || uri.password;
      database = database || uri.database;
      // The options box adds to the string's own, and wins where they overlap.
      const merged = new Map([...uri.options.split('&'), ...options.split('&')].filter(Boolean).map((kv) => [kv.split('=')[0], kv] as const));
      options = [...merged.values()].join('&');
    }
    // One host:port is split so an SSH tunnel can reach it; lists stay as they are.
    const single = /^([^,:/]+):(\d+)$/.exec(host);
    if (!srv && single) {
      host = single[1];
      portText = portText || single[2];
    }
  }
  if (kind === 'redis' && database && !/^\d+$/.test(database)) throw new Error('The database is a number, like 0.');

  const port = portText ? Number(portText) : DEFAULT_PORT[kind];
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The port is a number from 1 to 65535.');
  const conn: DbConnection = {
    id,
    name: v.name.trim() || database || host,
    kind,
    host,
    port,
    user,
    database,
    ssl: v.ssl as DbConnection['ssl'],
    ...(srv ? { srv } : {}),
    ...(kind === 'mongo' && options ? { options } : {}),
    ...(v.ssh ? { sshHostId: v.ssh } : {}),
  };
  // An empty password field keeps the saved one when editing.
  return { conn, password: password || (editing ? undefined : '') };
}
