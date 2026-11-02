import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../../components/Button';
import { Text } from '../../../components/Text';
import { makeStyles, useColors } from '../../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../../theme/tokens';
import { AuditReport, CATEGORIES, categoryScore } from './audit';

// The page checks: a score per category, then each check, failures first.
export function ChecksView({ report, onRun }: { report: AuditReport | null; onRun(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState<string | null>(null);
  const scoreColor = (n: number) => (n >= 90 ? colors.success : n >= 50 ? colors.warning : colors.destructive);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.top}>
        <Text variant="muted" style={styles.flex}>
          {report ? `Checked ${new Date(report.time).toLocaleTimeString()}. Heuristic checks of this page, not a full audit.` : 'Checks accessibility, SEO, best practices and performance of this page.'}
        </Text>
        <Button title={report ? 'Run again' : 'Run checks'} icon="activity" onPress={onRun} testID="devtools-run-checks" />
      </View>
      {report && (
        <>
          <View style={styles.scores}>
            {CATEGORIES.map((c) => {
              const score = categoryScore(report.checks, c.id);
              return (
                <View key={c.id} style={styles.score} accessible accessibilityLabel={`${c.label}: ${score ?? 'no checks'}`}>
                  <Text style={[styles.number, { color: score === null ? colors.mutedForeground : scoreColor(score) }]}>{score ?? '–'}</Text>
                  <Text variant="muted" style={styles.center} numberOfLines={1}>
                    {c.label}
                  </Text>
                </View>
              );
            })}
          </View>
          {CATEGORIES.map((c) => (
            <View key={c.id} style={styles.group}>
              <Text variant="label">{c.label}</Text>
              {report.checks
                .filter((x) => x.category === c.id)
                .sort((a, b) => Number(a.ok) - Number(b.ok))
                .map((x) => (
                  <Pressable key={x.id} onPress={() => x.items && setOpen(open === x.id ? null : x.id)} style={styles.check} accessibilityRole={x.items ? 'button' : undefined} testID={`check-${x.id}`}>
                    <Feather name={x.info ? 'info' : x.ok ? 'check-circle' : 'x-circle'} size={15} color={x.info ? colors.mutedForeground : x.ok ? colors.success : colors.destructive} style={styles.icon} />
                    <View style={styles.flex}>
                      <Text>{x.title}</Text>
                      {x.detail ? <Text variant="muted">{x.detail}</Text> : null}
                      {open === x.id &&
                        x.items?.map((item, i) => (
                          <Text key={i} style={styles.mono} selectable>
                            {item}
                          </Text>
                        ))}
                    </View>
                    {x.items && <Feather name={open === x.id ? 'chevron-up' : 'chevron-down'} size={15} color={colors.mutedForeground} />}
                  </Pressable>
                ))}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  content: { padding: spacing.sm, gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scores: { flexDirection: 'row', gap: spacing.xs },
  score: { flex: 1, alignItems: 'center', padding: spacing.xs, borderRadius: radius.md, borderWidth, borderColor: colors.border },
  number: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.xl },
  center: { textAlign: 'center', fontSize: fontSizes.xs },
  group: { gap: spacing.xs },
  check: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 4, borderBottomWidth: borderWidth, borderColor: colors.border },
  icon: { marginTop: 3 },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.mutedForeground },
}));
