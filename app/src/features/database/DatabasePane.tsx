import { useCallback, useEffect, useRef, useState } from 'react';
import { openDatabaseAsync } from 'expo-sqlite';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { documentsPath } from '../../runtime/paths';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { PROJECTS_DIR } from '../files/workspace';
import { Db, formatCell, listTables, PAGE_SIZE, QueryResult, Row, runSql, TableInfo, tablePage } from './database';

const CELL_WIDTH = 160;

async function openDb(project: string, path: string): Promise<Db> {
  const slash = path.lastIndexOf('/');
  const dir = `${documentsPath()}/${PROJECTS_DIR}/${project}${slash > 0 ? `/${path.slice(0, slash)}` : ''}`;
  // A connection of its own, so programs run in the terminal keep theirs.
  return openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, dir);
}

// Tables, rows and a SQL box for a .db / .sqlite file in the project. Free for everyone.
export function DatabasePane({ project, path }: { project: string; path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const db = useRef<Db | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'tables' | 'sql'>('tables');
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [page, setPage] = useState<{ columns: string[]; rows: Row[]; done: boolean } | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);

  const refreshTables = useCallback(async () => {
    if (!db.current) return;
    const list = await listTables(db.current);
    setTables(list);
    setTable((t) => (t && list.some((x) => x.name === t) ? t : (list[0]?.name ?? null)));
  }, []);

  useEffect(() => {
    let closed = false;
    openDb(project, path)
      .then(async (opened) => {
        if (closed) return opened.closeAsync();
        db.current = opened;
        await refreshTables();
      })
      .catch((e) => setError(`This database couldn't be opened: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      closed = true;
      db.current?.closeAsync().catch(() => undefined);
      db.current = null;
    };
  }, [project, path, refreshTables]);

  useEffect(() => {
    if (!table || !db.current) return setPage(null);
    tablePage(db.current, table, 0)
      .then((p) => setPage({ ...p, done: p.rows.length < PAGE_SIZE }))
      .catch((e) => setError(String(e?.message ?? e)));
  }, [table, tables]);

  const loadMore = async () => {
    if (!table || !db.current || !page || page.done) return;
    const next = await tablePage(db.current, table, page.rows.length);
    setPage({ columns: page.columns, rows: [...page.rows, ...next.rows], done: next.rows.length < PAGE_SIZE });
  };

  const run = async () => {
    if (!db.current) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await runSql(db.current, sql));
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
        <Segmented<'tables' | 'sql'>
          testID="database-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'tables', label: 'Tables' },
            { value: 'sql', label: 'SQL' },
          ]}
        />
      </View>
      {error && (
        <Text variant="error" style={styles.pad} selectable>
          {error}
        </Text>
      )}
      {mode === 'tables' ? (
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
          {page && <Grid columns={page.columns} rows={page.rows} onEnd={loadMore} />}
        </>
      ) : (
        <>
          <View style={styles.pad}>
            <TextInput
              testID="database-sql"
              value={sql}
              onChangeText={setSql}
              placeholder="SELECT * FROM users WHERE age > 30"
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
                      : 'Changes are saved to the file.'}
              </Text>
              <Button title={running ? 'Running…' : 'Run'} icon="play" onPress={run} disabled={running || !sql.trim()} testID="database-run" />
            </View>
          </View>
          {result?.kind === 'rows' && <Grid columns={result.columns} rows={result.rows} />}
        </>
      )}
    </View>
  );
}

function Grid({ columns, rows, onEnd }: { columns: string[]; rows: Row[]; onEnd?: () => void }) {
  const styles = useStyles();
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
                return (
                  <Text key={c} numberOfLines={1} selectable style={[styles.cell, styles.value, cell.muted && { color: colors.mutedForeground }]}>
                    {cell.text}
                  </Text>
                );
              })}
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  bar: { padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
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
