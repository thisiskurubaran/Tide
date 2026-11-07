import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '../../../components/ActionSheet';
import { Button, IconButton } from '../../../components/Button';
import { FormSheet } from '../../../components/FormSheet';
import { haptic } from '../../../components/haptics';
import { Text } from '../../../components/Text';
import { makeStyles, useColors } from '../../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../../theme/tokens';
import { useDatabaseStyles } from '../DatabaseView';
import { DOC_PAGE, MongoBrowser, MongoDoc } from './mongo';

interface MongoViewProps {
  // Connects; called again when `openKey` changes.
  open(): Promise<MongoBrowser>;
  openKey: string;
  // The database the connection names, opened first.
  database?: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const size = (n: number) => {
  let i = 0;
  while (n >= 1024 && i < SIZE_UNITS.length - 1) (n /= 1024), i++;
  return `${i ? n.toFixed(1) : n} ${SIZE_UNITS[i]}`;
};

// Databases, their collections and documents as Extended JSON, with a filter
// and sort. Changes go to the server at once.
export function MongoView({ open, openKey, database }: MongoViewProps) {
  const styles = useDatabaseStyles();
  const own = useStyles();
  const colors = useColors();
  const mongo = useRef<MongoBrowser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dbs, setDbs] = useState<{ name: string; size: number | null }[] | null>(null);
  const [db, setDb] = useState<string | null>(null);
  const [colls, setColls] = useState<{ name: string; kind: 'collection' | 'view' }[] | null>(null);
  const [coll, setColl] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('');
  // What the list shows; the boxes apply when Apply is tapped.
  const [query, setQuery] = useState({ filter: '', sort: '' });
  const [docs, setDocs] = useState<MongoDoc[] | null>(null);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState<MongoDoc | null>(null);
  const [editing, setEditing] = useState<MongoDoc | 'new' | null>(null);
  const load = useRef(0);

  useEffect(() => {
    let closed = false;
    setError(null);
    open()
      .then(async (opened) => {
        if (closed) return opened.close();
        mongo.current = opened;
        const list = await opened.databases();
        setDbs(list);
        // Skip the server's own databases when there's anything else.
        const mine = list.filter((d) => !['admin', 'config', 'local'].includes(d.name));
        setDb(database && list.some((d) => d.name === database) ? database : (mine[0] ?? list[0])?.name ?? database ?? null);
      })
      .catch((e) => setError(`Couldn't connect: ${message(e)}`));
    return () => {
      closed = true;
      mongo.current?.close().catch(() => undefined);
      mongo.current = null;
    };
    // `open` is rebuilt on every render; `openKey` says when it means another server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  const refreshColls = useCallback(async () => {
    if (!mongo.current || !db) return setColls(null);
    try {
      const list = await mongo.current.collections(db);
      setColls(list);
      setColl((c) => (c && list.some((x) => x.name === c) ? c : (list[0]?.name ?? null)));
    } catch (e) {
      setError(message(e));
    }
  }, [db]);
  useEffect(() => {
    refreshColls();
  }, [refreshColls]);

  const reload = useCallback(async () => {
    const id = ++load.current;
    if (!mongo.current || !db || !coll) {
      setDocs(null);
      setCount(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [first, n] = await Promise.all([mongo.current.find(db, coll, { ...query, skip: 0 }), mongo.current.count(db, coll, query.filter)]);
      if (id !== load.current) return;
      setDocs(first);
      setDone(first.length < DOC_PAGE);
      setCount(n);
    } catch (e) {
      if (id !== load.current) return;
      setDocs([]);
      setCount(null);
      setError(message(e));
    } finally {
      if (id === load.current) setLoading(false);
    }
  }, [db, coll, query]);
  useEffect(() => {
    reload();
  }, [reload]);

  const more = async () => {
    if (!mongo.current || !db || !coll || !docs || done || loading) return;
    const id = load.current;
    setLoading(true);
    try {
      const next = await mongo.current.find(db, coll, { ...query, skip: docs.length });
      if (id !== load.current) return;
      setDocs([...docs, ...next]);
      setDone(next.length < DOC_PAGE);
    } catch (e) {
      setError(message(e));
    } finally {
      if (id === load.current) setLoading(false);
    }
  };

  const view = colls?.find((c) => c.name === coll)?.kind === 'view';

  const remove = (doc: MongoDoc) =>
    Alert.alert('Delete this document?', 'It’s removed from the server. There’s no undo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await mongo.current!.remove(db!, coll!, doc.id!);
            haptic('success');
            await reload();
          } catch (e) {
            haptic('error');
            setError(message(e));
          }
        },
      },
    ]);

  const chips = <T extends { name: string }>(items: T[] | null, current: string | null, pick: (name: string) => void, detail: (item: T) => string, testPrefix: string, empty: string) => (
    <ScrollView horizontal style={styles.chips} contentContainerStyle={styles.chipsRow} showsHorizontalScrollIndicator={false}>
      {items?.length === 0 && <Text variant="muted">{empty}</Text>}
      {items?.map((item) => (
        <Pressable
          key={item.name}
          onPress={() => pick(item.name)}
          accessibilityRole="button"
          accessibilityState={{ selected: item.name === current }}
          style={[styles.chip, item.name === current && styles.chipOn]}
          testID={`${testPrefix}-${item.name}`}
        >
          <Text variant="label">{item.name}</Text>
          {detail(item) ? <Text variant="muted">{detail(item)}</Text> : null}
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="mongo">
      {chips(dbs, db, (name) => (setDb(name), setColl(null)), (d) => (d.size === null ? '' : size(d.size)), 'mongo-db', 'No databases.')}
      {chips(colls, coll, setColl, (c) => (c.kind === 'view' ? 'view' : ''), 'mongo-coll', 'No collections. Insert a document to make one.')}
      <View style={styles.pad}>
        <TextInput
          testID="mongo-filter"
          value={filter}
          onChangeText={setFilter}
          placeholder={'Filter: { age: { $gt: 30 } }'}
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          selectionColor={colors.brand}
          style={own.input}
        />
        <View style={styles.runRow}>
          <TextInput
            testID="mongo-sort"
            value={sort}
            onChangeText={setSort}
            placeholder={'Sort: { _id: -1 }'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            selectionColor={colors.brand}
            style={[own.input, styles.flex]}
          />
          <Button title="Apply" icon="filter" onPress={() => setQuery({ filter, sort })} disabled={!coll} testID="mongo-apply" />
        </View>
        <View style={styles.runRow}>
          <Text variant="muted" style={styles.flex}>
            {count === null ? (loading ? 'Loading…' : '') : `${count.toLocaleString()} ${count === 1 ? 'document' : 'documents'}${query.filter.trim() ? ' match' : ''}`}
          </Text>
          {db && !view && <IconButton icon="plus" label="Insert a document" onPress={() => setEditing('new')} testID="mongo-insert" />}
        </View>
      </View>
      {error && (
        <Text variant="error" style={styles.pad} selectable>
          {error}
        </Text>
      )}
      <FlatList
        style={styles.flex}
        data={docs ?? []}
        keyExtractor={(d, i) => d.id ?? String(i)}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl refreshing={loading && !!docs} onRefresh={() => (refreshColls(), reload())} tintColor={colors.mutedForeground} />}
        ListEmptyComponent={docs && coll ? <Text variant="muted" style={styles.empty}>No documents{query.filter.trim() ? ' match' : ''}.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable
            // Views and documents without an _id can't be written back.
            disabled={view || !item.id}
            onPress={() => setEditing(item)}
            onLongPress={() => setMenu(item)}
            accessibilityRole="button"
            accessibilityLabel="Document. Tap to edit, hold for actions."
            style={({ pressed }) => [own.doc, pressed && { backgroundColor: colors.secondary }]}
          >
            <Text style={styles.value} numberOfLines={14}>
              {item.json}
            </Text>
          </Pressable>
        )}
      />
      <FormSheet
        visible={editing !== null}
        title={editing === 'new' ? `Insert into ${coll ?? ''}` : 'Edit document'}
        description={
          editing === 'new'
            ? 'JSON, as mongosh takes it: ObjectId("…"), ISODate("…") and unquoted keys work. Without an _id the server makes one.'
            : 'The whole document is replaced. Its _id stays the same.'
        }
        confirmLabel={editing === 'new' ? 'Insert' : 'Save'}
        fields={[
          // A database without collections gets one with its first document.
          ...(editing === 'new' && !coll ? [{ key: 'collection', label: 'Collection', mono: true, required: true, placeholder: 'users' }] : []),
          { key: 'doc', label: 'Document', initial: editing === 'new' ? '{\n  \n}' : (editing?.json ?? ''), multiline: true, mono: true, required: true },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async ({ doc, collection }) => {
          const target = coll ?? collection.trim();
          if (editing === 'new') await mongo.current!.insert(db!, target, doc);
          else await mongo.current!.replace(db!, target, editing!.id!, doc);
          if (!coll) setColl(target);
          haptic('success');
          setEditing(null);
          if (!coll) await refreshColls();
          await reload();
        }}
      />
      <ActionSheet
        title={menu ? 'Document' : null}
        onClose={() => setMenu(null)}
        actions={
          menu
            ? [
                { label: 'Edit', icon: 'edit-2', onPress: () => setEditing(menu) },
                { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => remove(menu) },
              ]
            : []
        }
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  input: {
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
  },
  doc: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
}));
