import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '../../../components/ActionSheet';
import { Button, IconButton } from '../../../components/Button';
import { FormSheet } from '../../../components/FormSheet';
import { haptic } from '../../../components/haptics';
import { Badge } from '../../../components/Screen';
import { Segmented } from '../../../components/Segmented';
import { Text } from '../../../components/Text';
import { makeStyles, useColors } from '../../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../../theme/tokens';
import { Grid, useDatabaseStyles } from '../DatabaseView';
import {
  deleteKey,
  formatReply,
  formatTtl,
  KeyInfo,
  listDatabases,
  readValue,
  RedisClient,
  runCommand,
  scanKeys,
  selectDb,
  setString,
  STRING_LIMIT,
  Value,
} from './redis';

interface RedisViewProps {
  // Connects; called again when `openKey` changes.
  open(): Promise<{ client: RedisClient; db: number }>;
  openKey: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Keys (found with SCAN), their values by type, and a console for everything
// else. Changes go to the server at once.
export function RedisView({ open, openKey }: RedisViewProps) {
  const styles = useDatabaseStyles();
  const own = useStyles();
  const colors = useColors();
  const client = useRef<RedisClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'keys' | 'console'>('keys');
  const [db, setDb] = useState(0);
  const [dbs, setDbs] = useState<{ count: number; keys: Record<number, number> } | null>(null);
  const [pickingDb, setPickingDb] = useState(false);

  const [pattern, setPattern] = useState('');
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [cursor, setCursor] = useState('0');
  const [scanning, setScanning] = useState(false);
  const scanId = useRef(0);

  const [selected, setSelected] = useState<KeyInfo | null>(null);
  const [value, setValue] = useState<Value | null>(null);
  const [editing, setEditing] = useState(false);

  const [line, setLine] = useState('');
  const [log, setLog] = useState<{ command: string; reply: string; error: boolean }[]>([]);
  const [running, setRunning] = useState(false);

  // A new scan from the start; an older one still running is ignored.
  const rescan = useCallback(async (match: string) => {
    if (!client.current) return;
    const id = ++scanId.current;
    setScanning(true);
    setError(null);
    try {
      const [page, info] = await Promise.all([scanKeys(client.current, '0', match), listDatabases(client.current)]);
      if (id !== scanId.current) return;
      setKeys(page.keys);
      setCursor(page.cursor);
      setDbs(info);
    } catch (e) {
      if (id === scanId.current) setError(message(e));
    } finally {
      if (id === scanId.current) setScanning(false);
    }
  }, []);

  useEffect(() => {
    let closed = false;
    setError(null);
    open()
      .then(async (opened) => {
        if (closed) return opened.client.close();
        client.current = opened.client;
        setDb(opened.db);
        setReady(true);
        await rescan('');
      })
      .catch((e) => setError(`Couldn't connect: ${message(e)}`));
    return () => {
      closed = true;
      client.current?.close().catch(() => undefined);
      client.current = null;
      setReady(false);
    };
    // `open` is rebuilt on every render; `openKey` says when it means another server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, rescan]);

  const more = async () => {
    if (!client.current || scanning || cursor === '0' || !keys) return;
    const id = scanId.current;
    setScanning(true);
    try {
      const page = await scanKeys(client.current, cursor, pattern);
      if (id !== scanId.current) return;
      const seen = new Set(keys.map((k) => k.key));
      setKeys([...keys, ...page.keys.filter((k) => !seen.has(k.key))]);
      setCursor(page.cursor);
    } catch (e) {
      setError(message(e));
    } finally {
      if (id === scanId.current) setScanning(false);
    }
  };

  const openKeyValue = async (k: KeyInfo) => {
    if (!client.current) return;
    setSelected(k);
    setValue(null);
    setError(null);
    try {
      setValue(await readValue(client.current, k.key, k.type));
    } catch (e) {
      setError(message(e));
    }
  };

  const moreItems = async () => {
    if (!client.current || !selected || value?.kind !== 'items' || !value.cursor) return;
    const from = value.cursor;
    try {
      const next = await readValue(client.current, selected.key, selected.type, from);
      if (next.kind === 'items') setValue((v) => (v?.kind === 'items' && v.cursor === from ? { ...next, rows: [...v.rows, ...next.rows] } : v));
    } catch (e) {
      setError(message(e));
    }
  };

  const switchDb = async (n: number) => {
    if (!client.current) return;
    try {
      await selectDb(client.current, n);
      setDb(n);
      setSelected(null);
      haptic('success');
      await rescan(pattern);
    } catch (e) {
      haptic('error');
      setError(message(e));
    }
  };

  const remove = (k: KeyInfo) =>
    Alert.alert(`Delete ${k.key}?`, 'The key and its value are removed from the server. There’s no undo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteKey(client.current!, k.key);
            haptic('success');
            setSelected(null);
            setKeys((list) => list?.filter((x) => x.key !== k.key) ?? null);
          } catch (e) {
            haptic('error');
            setError(message(e));
          }
        },
      },
    ]);

  const send = async () => {
    if (!client.current || !line.trim()) return;
    setRunning(true);
    const command = line.trim();
    try {
      const r = await runCommand(client.current, command);
      if (r.db !== undefined) {
        setDb(r.db);
        setSelected(null);
      }
      const isErr = !!r.reply && typeof r.reply === 'object' && 'error' in r.reply;
      setLog((l) => [...l.slice(-199), { command, reply: formatReply(r.reply), error: isErr }]);
      setLine('');
      haptic(isErr ? 'error' : 'success');
    } catch (e) {
      haptic('error');
      setLog((l) => [...l.slice(-199), { command, reply: message(e), error: true }]);
    } finally {
      setRunning(false);
    }
  };

  const dbLabel = `db${db}`;

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="redis">
      <View style={styles.bar}>
        <Segmented<'keys' | 'console'>
          testID="redis-mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            // Commands typed there may have changed keys.
            if (m === 'keys' && ready) rescan(pattern);
          }}
          options={[
            { value: 'keys', label: 'Keys' },
            { value: 'console', label: 'Console' },
          ]}
        />
        <View style={styles.flex} />
        {ready && (
          <Pressable onPress={() => setPickingDb(true)} accessibilityRole="button" accessibilityLabel={`Database ${db}. Tap to switch.`} style={[styles.chip, styles.chipOn]} testID="redis-db">
            <Text variant="label">{dbLabel}</Text>
            <Text variant="muted">{(dbs?.keys[db] ?? 0).toLocaleString()}</Text>
          </Pressable>
        )}
      </View>
      {error && (
        <Text variant="error" style={styles.pad} selectable>
          {error}
        </Text>
      )}
      {mode === 'console' ? (
        <>
          <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
            {log.length === 0 && <Text variant="muted">Type a command as you would in redis-cli, like HGETALL user:1. It runs on {dbLabel}; SELECT switches.</Text>}
            {log.map((entry, i) => (
              <View key={i} style={own.entry}>
                <Text style={[styles.value, { color: colors.mutedForeground }]} selectable>
                  {`> ${entry.command}`}
                </Text>
                <Text style={[styles.value, entry.error && { color: colors.destructive }]} selectable>
                  {entry.reply}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.pad, own.inputRow]}>
            <TextInput
              testID="redis-command"
              value={line}
              onChangeText={setLine}
              onSubmitEditing={send}
              placeholder="GET greeting"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="send"
              selectionColor={colors.brand}
              style={[own.input, styles.flex]}
            />
            <Button title={running ? 'Sending…' : 'Send'} icon="send" onPress={send} disabled={running || !line.trim() || !ready} testID="redis-send" />
          </View>
        </>
      ) : selected ? (
        <View style={styles.flex}>
          <View style={[styles.pad, own.keyHead]}>
            <IconButton icon="arrow-left" label="Back to keys" onPress={() => setSelected(null)} testID="redis-back" />
            <View style={styles.flex}>
              <Text style={styles.value} numberOfLines={2} selectable>
                {selected.key}
              </Text>
              <Text variant="muted">
                {selected.type} · {formatTtl(selected.ttl)}
                {value?.kind === 'items' ? ` · ${value.total.toLocaleString()} ${value.total === 1 ? 'item' : 'items'}` : value?.kind === 'string' ? ` · ${value.length.toLocaleString()} bytes` : ''}
              </Text>
            </View>
            {value?.kind === 'string' && !value.truncated && <IconButton icon="edit-2" label="Edit value" onPress={() => setEditing(true)} testID="redis-edit" />}
            <IconButton icon="refresh-cw" label="Reload" onPress={() => openKeyValue(selected)} />
            <IconButton icon="trash-2" label="Delete key" color={colors.destructive} onPress={() => remove(selected)} testID="redis-delete" />
          </View>
          {value?.kind === 'string' ? (
            <ScrollView style={styles.flex} contentContainerStyle={styles.pad}>
              <Text style={styles.value} selectable testID="redis-string">
                {value.text}
              </Text>
              {value.truncated && <Text variant="muted">Showing the first {(STRING_LIMIT / 1024).toLocaleString()} KB. Use GETRANGE in the console for the rest.</Text>}
            </ScrollView>
          ) : value?.kind === 'items' ? (
            <Grid columns={value.columns} rows={value.rows.map((r) => Object.fromEntries(value.columns.map((c, i) => [c, r[i]])))} onEnd={moreItems} />
          ) : value?.kind === 'other' ? (
            <Text variant="muted" style={styles.pad}>
              {value.note}
            </Text>
          ) : null}
        </View>
      ) : (
        <>
          <View style={styles.pad}>
            <TextInput
              testID="redis-pattern"
              value={pattern}
              onChangeText={setPattern}
              onSubmitEditing={() => rescan(pattern)}
              placeholder="Filter: user:* or *session*"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
              selectionColor={colors.brand}
              style={own.input}
            />
          </View>
          <FlatList
            data={keys ?? []}
            keyExtractor={(k) => k.key}
            onEndReached={more}
            onEndReachedThreshold={0.5}
            refreshControl={<RefreshControl refreshing={scanning && !!keys} onRefresh={() => rescan(pattern)} tintColor={colors.mutedForeground} />}
            ListEmptyComponent={keys ? <Text variant="muted" style={styles.empty}>{pattern ? `No keys match ${pattern} in ${dbLabel}.` : `${dbLabel} has no keys.`}</Text> : undefined}
            ListFooterComponent={
              keys?.length ? (
                <Text variant="muted" style={styles.empty}>
                  {keys.length.toLocaleString()} {keys.length === 1 ? 'key' : 'keys'}
                  {cursor !== '0' ? (scanning ? ' · scanning…' : ' · scroll for more') : ''}
                </Text>
              ) : undefined
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => openKeyValue(item)}
                onLongPress={() => remove(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.key}, ${item.type}, ${formatTtl(item.ttl)}. Hold to delete.`}
                style={({ pressed }) => [own.keyRow, pressed && { backgroundColor: colors.secondary }]}
                testID={`redis-key-${item.key}`}
              >
                <Text style={[styles.value, styles.flex]} numberOfLines={1}>
                  {item.key}
                </Text>
                {item.ttl !== -1 && <Text variant="muted">{formatTtl(item.ttl)}</Text>}
                <Badge label={item.type} />
              </Pressable>
            )}
          />
        </>
      )}
      <FormSheet
        visible={editing}
        title={selected ? `Edit ${selected.key}` : ''}
        description="Saved to the server at once. The key keeps its expiry."
        confirmLabel="Save"
        fields={[{ key: 'value', label: 'Value', initial: value?.kind === 'string' ? value.text : '', multiline: true, mono: true }]}
        onClose={() => setEditing(false)}
        onSubmit={async ({ value: text }) => {
          await setString(client.current!, selected!.key, text);
          haptic('success');
          setEditing(false);
          await openKeyValue(selected!);
        }}
      />
      <ActionSheet
        title={pickingDb ? 'Database' : null}
        onClose={() => setPickingDb(false)}
        actions={Array.from({ length: dbs?.count ?? 16 }, (_, n) => ({
          label: `db${n}${dbs?.keys[n] ? ` · ${dbs.keys[n].toLocaleString()} keys` : ''}`,
          icon: n === db ? ('check' as const) : ('database' as const),
          onPress: () => {
            setPickingDb(false);
            if (n !== db) switchDb(n);
          },
        }))}
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
  inputRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: borderWidth, borderColor: colors.border },
  entry: { gap: 2, paddingBottom: spacing.sm },
  keyHead: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: borderWidth, borderColor: colors.border },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm + 2, borderBottomWidth: borderWidth, borderColor: colors.border },
}));
