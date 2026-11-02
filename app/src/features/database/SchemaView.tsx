import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { SchemaTable } from './database';
import type { DbSource } from './source';

const target = (table: string, to: string) => (to ? `${table}.${to}` : table);

// The database's tables as cards: columns with their types and keys, and
// where each foreign key points.
export function SchemaView({ source, onOpenTable }: { source: DbSource; onOpenTable(name: string): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [tables, setTables] = useState<SchemaTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    source.schema().then(setTables, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [source]);

  if (error) {
    return (
      <Text variant="error" style={styles.pad}>
        {error}
      </Text>
    );
  }
  if (!tables) return <ActivityIndicator style={styles.pad} color={colors.mutedForeground} />;

  const links = tables.flatMap((t) => t.foreignKeys.map((fk) => ({ from: t.name, fk })));
  return (
    <ScrollView contentContainerStyle={styles.list} testID="schema">
      <Text variant="muted">
        {tables.length} {tables.length === 1 ? 'table' : 'tables'} · {links.length} {links.length === 1 ? 'relationship' : 'relationships'}
      </Text>
      {links.length > 0 && (
        <View style={styles.card}>
          <Text variant="label">Relationships</Text>
          {links.map(({ from, fk }, i) => (
            <Text key={i} variant="mono" style={styles.small}>
              {from}({fk.columns.join(', ')}) <Text style={{ color: colors.brand }}>→</Text> {fk.table}
              {fk.to.some(Boolean) ? `(${fk.to.join(', ')})` : ''}
            </Text>
          ))}
        </View>
      )}
      {tables.map((t) => {
        const fkFor = (col: string) => t.foreignKeys.find((fk) => fk.columns.includes(col));
        return (
          <View key={t.name} style={styles.card} testID={`schema-${t.name}`}>
            <View style={styles.head}>
              <Feather name={t.kind === 'view' ? 'eye' : 'grid'} size={14} color={colors.mutedForeground} />
              <Text variant="label" style={styles.flex} onPress={() => onOpenTable(t.name)} accessibilityRole="link">
                {t.name}
              </Text>
              {t.kind === 'view' && <Text variant="muted">view</Text>}
            </View>
            {t.columns.map((c) => {
              const fk = fkFor(c.name);
              return (
                <View key={c.name} style={styles.col}>
                  <View style={styles.keyCell}>
                    {c.primary ? <Feather name="key" size={12} color={colors.warning} /> : fk ? <Feather name="link" size={12} color={colors.brand} /> : null}
                  </View>
                  <Text variant="mono" numberOfLines={1} style={[styles.small, styles.colName]}>
                    {c.name}
                    {c.nullable ? <Text style={{ color: colors.mutedForeground }}>?</Text> : null}
                  </Text>
                  <Text variant="mono" numberOfLines={1} style={[styles.small, styles.type, { color: colors.mutedForeground }]}>
                    {fk ? `→ ${target(fk.table, fk.to[fk.columns.indexOf(c.name)] ?? '')}` : c.type.toLowerCase()}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: { padding: spacing.md },
  list: { padding: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xl },
  card: { gap: 3, padding: spacing.sm + 2, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2, paddingBottom: spacing.xs },
  flex: { flex: 1 },
  col: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  keyCell: { width: 14, alignItems: 'center' },
  colName: { flex: 1 },
  type: { flexShrink: 1, maxWidth: '55%', textAlign: 'right' },
  small: { fontSize: fontSizes.xs + 1, fontFamily: fonts.mono.regular },
}));
