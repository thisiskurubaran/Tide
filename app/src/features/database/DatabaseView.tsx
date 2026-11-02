import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { formatCell, PAGE_SIZE, QueryResult, Row, TableInfo, toCsv } from './database';
import type { DbSource } from './source';
import { SchemaView } from './SchemaView';

const CELL_WIDTH = 160;

interface DatabaseViewProps {
  // Opens the database; called again when `openKey` changes.
  open(): Promise<DbSource>;
  openKey: string;
  // Saves an export (users.csv, or query.csv for SQL results) and says where it went.
  saveCsv(name: string, csv: string): Promise<string | null>;
}

// Tables, rows and a SQL box for a SQLite file or a database server: edit
// cells, add and delete rows, export CSV. Free for everyone.
export function DatabaseView({ open, openKey, saveCsv }: DatabaseViewProps) {
  const styles = useDatabaseStyles();
  const colors = useColors();
  const db = useRef<DbSource | null>(null);
  const [notes, setNotes] = useState<Pick<DbSource, 'readOnlyNote' | 'sqlNote' | 'sqlPlaceholder'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'tables' | 'sql' | 'schema'>('tables');
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [page, setPage] = useState<{ columns: string[]; rows: Row[]; done: boolean; editable: boolean } | null>(null);
  const [editing, setEditing] = useState<{ row: Row; column: string } | null>(null);
  const [rowMenu, setRowMenu] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);

  const refreshTables = useCallback(async () => {
    if (!db.current) return;
    const list = await db.current.listTables();
    setTables(list);
    setTable((t) => (t && list.some((x) => x.name === t) ? t : (list[0]?.name ?? null)));
  }, []);

  useEffect(() => {
    let closed = false;
    setError(null);
    open()
      .then(async (opened) => {
        if (closed) return opened.close();
        db.current = opened;
        setNotes(opened);
        await refreshTables();
      })
      .catch((e) => setError(`This database couldn't be opened: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      closed = true;
      db.current?.close().catch(() => undefined);
      db.current = null;
    };
    // `open` is rebuilt on every render; `openKey` says when it means another database.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, refreshTables]);

  const reloadPage = useCallback(() => {
    if (!table || !db.current) return setPage(null);
    db.current
      .page(table, 0)
      .then((p) => setPage({ ...p, done: p.rows.length < PAGE_SIZE }))
      .catch((e) => setError(String(e?.message ?? e)));
  }, [table]);
  useEffect(reloadPage, [reloadPage, tables]);

  const loadMore = async () => {
    if (!table || !db.current || !page || page.done) return;
    const next = await db.current.page(table, page.rows.length);
    setPage({ ...page, rows: [...page.rows, ...next.rows], done: next.rows.length < PAGE_SIZE });
  };

  const exportCsv = async () => {
    if (!db.current) return;
    try {
      const data = mode === 'sql' && result?.kind === 'rows' ? result : table ? await db.current.allRows(table) : null;
      if (!data) return;
      const where = await saveCsv(`${mode === 'sql' ? 'query' : table!.replace(/[^\w.-]+/g, '_')}.csv`, toCsv(data.columns, data.rows));
      if (!where) return;
      haptic('success');
      Alert.alert('Exported', `${data.rows.length.toLocaleString()} rows ${where}.`);
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Edits change the database at once, like the SQL box.
  const change = async (fn: (d: DbSource) => Promise<unknown>) => {
    await fn(db.current!);
    haptic('success');
    await refreshTables();
    reloadPage();
  };

  const run = async () => {
    if (!db.current) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await db.current.run(sql));
      haptic('success');
      // CREATE, DROP and friends change the table list.
      await refreshTables();
    } catch (e) {
      haptic('error');
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="database">
      <View style={styles.bar}>
        <Segmented<'tables' | 'sql' | 'schema'>
          testID="database-mode"
          value={mode}
          onChange={(m) => setMode(m)}
          options={[
            { value: 'tables', label: 'Tables' },
            { value: 'sql', label: 'SQL' },
            { value: 'schema', label: 'Schema' },
          ]}
        />
        <View style={styles.flex} />
        {mode === 'schema' ? null : mode === 'tables' && page?.editable && <IconButton icon="plus" label="Add a row" onPress={() => setAdding(true)} testID="database-add-row" />}
        {mode !== 'schema' && <IconButton icon="download" label="Export CSV" onPress={exportCsv} testID="database-export" />}
      </View>
      {error && (
        <Text variant="error" style={styles.pad} selectable>
          {error}
        </Text>
      )}
      {mode === 'schema' ? (
        db.current && (
          <SchemaView
            source={db.current}
            onOpenTable={(name) => {
              setTable(name);
              setMode('tables');
            }}
          />
        )
      ) : mode === 'tables' ? (
        <>
          <ScrollView horizontal style={styles.chips} contentContainerStyle={styles.chipsRow} showsHorizontalScrollIndicator={false}>
            {tables?.length === 0 && <Text variant="muted">No tables yet. Create one in SQL.</Text>}
            {tables?.map((t) => (
              <Pressable
                key={t.name}
                onPress={() => setTable(t.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: t.name === table }}
                style={[styles.chip, t.name === table && styles.chipOn]}
                testID={`table-${t.name}`}
              >
                <Text variant="label">{t.name}</Text>
                <Text variant="muted">{t.kind === 'view' ? 'view' : (t.rows ?? '?').toLocaleString()}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {page && (
            <Grid
              columns={page.columns}
              rows={page.rows}
              onEnd={loadMore}
              onCell={page.editable ? (row, column) => setEditing({ row, column }) : undefined}
              onRow={page.editable ? setRowMenu : undefined}
            />
          )}
          {page && !page.editable && notes && (
            <Text variant="muted" style={styles.pad}>
              {notes.readOnlyNote}
            </Text>
          )}
        </>
      ) : (
        <>
          <View style={styles.pad}>
            <TextInput
              testID="database-sql"
              value={sql}
              onChangeText={setSql}
              placeholder={notes?.sqlPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              selectionColor={colors.brand}
              style={styles.sql}
            />
            <View style={styles.runRow}>
              <Text variant="muted" style={styles.flex}>
                {result?.kind === 'rows'
                  ? `${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? 'row' : 'rows'}`
                  : result?.kind === 'changes'
                    ? `${result.changes.toLocaleString()} ${result.changes === 1 ? 'row' : 'rows'} changed`
                    : result?.kind === 'done'
                      ? 'Done'
                      : notes?.sqlNote}
              </Text>
              <Button title={running ? 'Running…' : 'Run'} icon="play" onPress={run} disabled={running || !sql.trim()} testID="database-run" />
            </View>
          </View>
          {result?.kind === 'rows' && <Grid columns={result.columns} rows={result.rows} />}
        </>
      )}
      <FormSheet
        visible={editing !== null}
        title={editing ? `Edit ${editing.column}` : ''}
        confirmLabel="Save"
        fields={[
          {
            key: 'value',
            label: 'Value',
            initial: editing ? (editing.row[editing.column] === null ? 'NULL' : String(editing.row[editing.column])) : '',
            multiline: true,
            mono: true,
            hint: 'Type NULL for no value.',
          },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async ({ value }) => {
          await change((d) => d.updateCell(table!, editing!.row, editing!.column, value));
          setEditing(null);
        }}
      />
      <FormSheet
        visible={adding}
        title={`Add a row to ${table ?? ''}`}
        description="Empty fields get the column's default."
        confirmLabel="Add"
        fields={(page?.columns ?? []).map((c) => ({ key: c, label: c, mono: true }))}
        onClose={() => setAdding(false)}
        onSubmit={async (values) => {
          await change((d) => d.insertRow(table!, values));
          setAdding(false);
        }}
      />
      <ActionSheet
        title={rowMenu ? 'Row' : null}
        onClose={() => setRowMenu(null)}
        actions={[
          {
            label: 'Delete row',
            icon: 'trash-2',
            destructive: true,
            onPress: () => {
              const row = rowMenu!;
              change((d) => d.deleteRow(table!, row)).catch((e) => setError(String(e?.message ?? e)));
            },
          },
        ]}
      />
    </View>
  );
}

// Also shows Redis hashes, lists, sets and sorted sets.
export function Grid({
  columns,
  rows,
  onEnd,
  onCell,
  onRow,
}: {
  columns: string[];
  rows: Row[];
  onEnd?: () => void;
  onCell?: (row: Row, column: string) => void;
  onRow?: (row: Row) => void;
}) {
  const styles = useDatabaseStyles();
  const colors = useColors();
  const width = Math.max(1, columns.length) * CELL_WIDTH;
  return (
    <ScrollView horizontal style={styles.flex} bounces={false}>
      <View style={{ width }}>
        <View style={[styles.gridRow, styles.head]}>
          {columns.map((c) => (
            <Text key={c} variant="label" numberOfLines={1} style={styles.cell}>
              {c}
            </Text>
          ))}
        </View>
        <FlatList
          data={rows}
          keyExtractor={(_, i) => String(i)}
          onEndReached={onEnd}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={<Text variant="muted" style={styles.empty}>No rows</Text>}
          renderItem={({ item, index }) => (
            <View style={[styles.gridRow, index % 2 === 1 && { backgroundColor: colors.secondary }]}>
              {columns.map((c) => {
                const cell = formatCell(item[c]);
                const text = (
                  <Text numberOfLines={1} selectable={!onCell} style={[styles.value, cell.muted && { color: colors.mutedForeground }]}>
                    {cell.text}
                  </Text>
                );
                return onCell ? (
                  <Pressable
                    key={c}
                    onPress={() => onCell(item, c)}
                    onLongPress={() => onRow?.(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c}: ${cell.text}. Tap to edit, hold for row actions.`}
                    style={styles.cell}
                  >
                    {text}
                  </Pressable>
                ) : (
                  <View key={c} style={styles.cell}>
                    {text}
                  </View>
                );
              })}
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}

// Shared with the Redis and MongoDB views so all servers look alike.
export const useDatabaseStyles = makeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  pad: { padding: spacing.sm, gap: spacing.sm },
  flex: { flex: 1 },
  chips: { flexGrow: 0, borderBottomWidth: borderWidth, borderColor: colors.border },
  chipsRow: { padding: spacing.sm, gap: spacing.sm, alignItems: 'center' },
  chip: { flexDirection: 'row', gap: spacing.xs + 2, alignItems: 'center', paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  gridRow: { flexDirection: 'row', borderBottomWidth: borderWidth, borderColor: colors.border },
  head: { backgroundColor: colors.card },
  cell: { width: CELL_WIDTH, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs + 2 },
  value: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs + 1, color: colors.foreground },
  empty: { padding: spacing.md },
  sql: {
    minHeight: 96,
    maxHeight: 200,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
    textAlignVertical: 'top',
  },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
}));
