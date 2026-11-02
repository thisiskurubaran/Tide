import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { buffersStore, useBuffers, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { fromBase64 } from '../backup/zip';
import { Aggregate, columnStats, filterRows, groupBy, isNumeric, parseCsv, SortDir, sortRows, Table } from './table';

type Mode = 'table' | 'chart' | 'columns';
const CHAR_WIDTH = 7.6;
const ROW_HEIGHT = 34;

const format = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 3 }));

// CSV, TSV and Parquet files as a table: sort by a column, filter rows, see
// each column's stats, and chart a column grouped by another.
export function DataPane({ project, path }: { project: string; path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const parquet = /\.parquet$/i.test(path);
  const content = useBuffers((s) => (parquet ? undefined : s.buffers[bufferKey(project, path)]?.content));
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('table');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: number; dir: SortDir } | null>(null);
  const [row, setRow] = useState<string[] | null>(null);

  useEffect(() => {
    if (!parquet && content === undefined) buffersStore.getState().load(project, path).catch((e: Error) => setError(e.message));
  }, [parquet, content, project, path]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // A tick first, so the spinner shows before a big file is parsed.
    const timer = setTimeout(async () => {
      try {
        let next: Table;
        if (parquet) {
          const { readParquet } = require('./parquet') as typeof import('./parquet');
          const bytes = fromBase64(await workspace.readBase64(project, path));
          next = await readParquet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        } else if (content !== undefined) next = parseCsv(content, /\.tsv$/i.test(path) ? { delimiter: '\t' } : {});
        else return;
        if (!cancelled) setTable(next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [parquet, content, project, path]);

  const rows = useMemo(() => {
    if (!table) return [];
    const sorted = sort ? sortRows(table, sort.column, sort.dir) : table.rows;
    return filterRows(table, sorted, query);
  }, [table, sort, query]);

  const widths = useMemo(() => {
    if (!table) return [];
    return table.columns.map((c, i) => {
      let chars = c.length + 2;
      for (const r of table.rows.slice(0, 200)) chars = Math.max(chars, Math.min(40, (r[i] ?? '').length));
      return Math.max(64, Math.min(300, chars * CHAR_WIDTH + 20));
    });
  }, [table]);

  if (error) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <Text variant="error" selectable>
          {parquet ? `This Parquet file couldn't be read: ${error}` : error}
        </Text>
      </View>
    );
  }
  if (!table) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  const toggleSort = (column: number) =>
    setSort((s) => (s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null));
  const total = table.rows.length;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} testID="data-pane">
      <View style={styles.toolbar}>
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'table', label: 'Table' },
            { value: 'chart', label: 'Chart' },
            { value: 'columns', label: 'Columns' },
          ]}
          testID="data-mode"
        />
        <View style={styles.search}>
          <Feather name="search" size={14} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Filter rows"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            testID="data-filter"
          />
        </View>
      </View>
      <Text variant="muted" style={styles.count} testID="data-count">
        {query ? `${format(rows.length)} of ${format(total)} rows` : `${format(total)} rows`} · {table.columns.length} columns
        {table.truncated ? ` · only the first ${format(total)} rows were read` : ''}
      </Text>

      {mode === 'table' && (
        <ScrollView horizontal style={styles.flex} contentContainerStyle={{ flexDirection: 'column' }}>
          <View style={[styles.row, styles.header]}>
            {table.columns.map((c, i) => (
              <Pressable key={i} onPress={() => toggleSort(i)} style={[styles.cell, { width: widths[i] }]} accessibilityRole="button" accessibilityLabel={`Sort by ${c}`} testID={`data-col-${i}`}>
                <Text variant="label" numberOfLines={1} style={styles.flexShrink}>
                  {c}
                </Text>
                {sort?.column === i && <Feather name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={colors.brand} />}
              </Pressable>
            ))}
          </View>
          <FlatList
            data={rows}
            keyExtractor={(_r, i) => String(i)}
            initialNumToRender={30}
            windowSize={10}
            getItemLayout={(_d, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
            renderItem={({ item, index }) => (
              <Pressable onPress={() => setRow(item)} accessibilityRole="button" accessibilityHint="Shows the whole row" style={[styles.row, index % 2 === 1 && { backgroundColor: colors.card }]} testID={`data-row-${index}`}>
                {table.columns.map((_c, i) => (
                  <Text key={i} numberOfLines={1} style={[styles.cell, styles.mono, { width: widths[i] }]}>
                    {item[i]}
                  </Text>
                ))}
              </Pressable>
            )}
            ListEmptyComponent={<Text variant="muted" style={styles.empty}>{query ? 'No rows match the filter.' : 'This file has no rows.'}</Text>}
          />
        </ScrollView>
      )}
      {mode === 'chart' && <ChartView table={table} rows={rows} />}
      {mode === 'columns' && (
        <ScrollView style={styles.flex} contentContainerStyle={styles.stats}>
          {table.columns.map((_c, i) => {
            const s = columnStats({ ...table, rows }, i);
            return (
              <View key={i} style={styles.statCard} testID={`data-stats-${i}`}>
                <Text variant="label">
                  {s.name} <Text variant="muted">{s.numeric ? 'number' : 'text'}</Text>
                </Text>
                <Text variant="muted">
                  {format(s.count - s.empty)} values · {format(s.empty)} empty · {format(s.distinct)} distinct
                </Text>
                {s.numeric && s.min !== undefined && (
                  <Text style={styles.mono}>
                    min {format(s.min)} · max {format(s.max!)} · mean {format(s.mean!)} · sum {format(s.sum!)}
                  </Text>
                )}
                {s.top && s.top.length > 0 && (
                  <Text style={styles.mono} numberOfLines={3}>
                    {s.top.map((t) => `${t.value} (${format(t.count)})`).join(' · ')}
                  </Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Sheet visible={row !== null} onClose={() => setRow(null)} scrollable>
        <Text variant="title">Row</Text>
        {row &&
          table.columns.map((c, i) => (
            <View key={i} style={styles.field}>
              <Text variant="muted">{c}</Text>
              <Text selectable style={styles.mono}>
                {row[i] || '—'}
              </Text>
            </View>
          ))}
      </Sheet>
    </View>
  );
}

// Bars of one column's values grouped by another, biggest first.
function ChartView({ table, rows }: { table: Table; rows: string[][] }) {
  const styles = useStyles();
  const colors = useColors();
  const numeric = useMemo(() => table.columns.map((_c, i) => isNumeric(table, i)), [table]);
  const firstText = numeric.indexOf(false);
  const [by, setBy] = useState(firstText >= 0 ? firstText : 0);
  const [value, setValue] = useState<number | null>(numeric.indexOf(true) >= 0 ? numeric.indexOf(true) : null);
  const [aggregate, setAggregate] = useState<Aggregate>(value === null ? 'count' : 'sum');
  const bars = useMemo(() => groupBy(rows, by, aggregate === 'count' ? null : value, aggregate), [rows, by, value, aggregate]);
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);

  const chips = (items: { key: string; label: string; on: boolean; onPress(): void }[]) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {items.map((it) => (
        <Pressable key={it.key} onPress={it.onPress} style={[styles.chip, it.on && { borderColor: colors.brand, backgroundColor: colors.brandSoft }]} accessibilityRole="button" accessibilityState={{ selected: it.on }}>
          <Text numberOfLines={1}>{it.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.chart} testID="data-chart">
      <Text variant="muted">Group by</Text>
      {chips(table.columns.map((c, i) => ({ key: `by-${i}`, label: c, on: by === i, onPress: () => setBy(i) })))}
      <Text variant="muted">Show</Text>
      {chips([
        { key: 'count', label: 'Row count', on: aggregate === 'count', onPress: () => setAggregate('count') },
        ...table.columns.flatMap((c, i) =>
          numeric[i]
            ? [
                { key: `sum-${i}`, label: `Sum of ${c}`, on: aggregate === 'sum' && value === i, onPress: () => (setValue(i), setAggregate('sum')) },
                { key: `mean-${i}`, label: `Mean of ${c}`, on: aggregate === 'mean' && value === i, onPress: () => (setValue(i), setAggregate('mean')) },
              ]
            : [],
        ),
      ])}
      {bars.length === 0 && <Text variant="muted">No values to chart.</Text>}
      {bars.map((b) => (
        <View key={b.label} style={styles.barRow} accessible accessibilityLabel={`${b.label}: ${format(b.value)}`}>
          <Text numberOfLines={1} style={styles.barLabel}>
            {b.label}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width: `${(Math.abs(b.value) / max) * 100}%`, backgroundColor: b.value < 0 ? colors.destructive : colors.brand }]} />
          </View>
          <Text style={[styles.mono, styles.barValue]}>{format(b.value)}</Text>
        </View>
      ))}
      {bars.length === 30 && <Text variant="muted">Showing the 30 biggest groups.</Text>}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, flexWrap: 'wrap' },
  bar: { height: '100%', borderRadius: radius.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, minWidth: 140 },
  input: { flex: 1, height: 34, color: colors.foreground, fontSize: fontSizes.sm },
  count: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, fontSize: fontSizes.xs },
  row: { flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'center' },
  header: { borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.secondary },
  cell: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, height: ROW_HEIGHT, lineHeight: ROW_HEIGHT, overflow: 'hidden' },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs + 1, color: colors.foreground },
  empty: { padding: spacing.md },
  stats: { padding: spacing.sm, gap: spacing.sm },
  statCard: { gap: 2, padding: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  field: { gap: 2, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  chart: { padding: spacing.sm, gap: spacing.sm },
  chips: { gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 26 },
  barLabel: { width: 110, fontSize: fontSizes.sm },
  barTrack: { flex: 1, height: 16 },
  barValue: { minWidth: 64, textAlign: 'right' },
}));
