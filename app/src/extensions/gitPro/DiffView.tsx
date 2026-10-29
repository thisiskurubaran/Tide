import { ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { Hunk, lineText } from './diff';

export interface HunkAction {
  label: string;
  run(hunk: Hunk): void;
  destructive?: boolean;
}

interface DiffViewProps {
  // null when the file is too large to diff.
  hunks: Hunk[] | null;
  actions?: HunkAction[];
  busy?: boolean;
  empty?: string;
}

// A unified diff, one block per hunk, with the hunk's actions in its header.
// Long lines scroll sideways rather than wrapping, like code in the editor.
export function DiffView({ hunks, actions = [], busy, empty = 'No changes.' }: DiffViewProps) {
  const styles = useStyles();
  const colors = useColors();
  if (hunks === null) return <Text variant="muted">This file is too large to show a diff.</Text>;
  if (hunks.length === 0) return <Text variant="muted">{empty}</Text>;
  return (
    <View style={styles.hunks}>
      {hunks.map((h, i) => (
        <View key={`${h.oldStart}-${h.newStart}-${i}`} style={styles.hunk} testID={`hunk-${i}`}>
          <View style={styles.header}>
            <Text variant="mono" style={styles.range}>
              @@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
            </Text>
            {actions.map((a) => (
              <Button
                key={a.label}
                title={a.label}
                variant="outline"
                onPress={() => a.run(h)}
                disabled={busy}
                testID={`hunk-${i}-${a.label.toLowerCase().replace(/\W+/g, '-')}`}
              />
            ))}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View>
              {h.lines.map((l, j) => {
                const bg = l.kind === 'add' ? colors.successSoft : l.kind === 'del' ? colors.destructiveSoft : undefined;
                const sign = l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' ';
                const noNewline = !l.text.endsWith('\n');
                return (
                  <View key={j} style={[styles.line, bg ? { backgroundColor: bg } : null]}>
                    <Text variant="mono" style={styles.number}>
                      {l.oldLine ?? ''}
                    </Text>
                    <Text variant="mono" style={styles.number}>
                      {l.newLine ?? ''}
                    </Text>
                    <Text variant="mono" style={[styles.code, { color: l.kind === 'same' ? colors.mutedForeground : colors.foreground }]}>
                      {sign} {lineText(l.text)}
                      {noNewline ? <Text variant="mono" style={styles.eol}>{'  ⏎ no newline at end of file'}</Text> : null}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  hunks: { gap: spacing.md },
  hunk: { borderWidth, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.secondary,
  },
  range: { flex: 1, color: colors.mutedForeground, fontSize: fontSizes.xs },
  line: { flexDirection: 'row' },
  number: { width: 36, textAlign: 'right', paddingRight: spacing.xs, color: colors.mutedForeground, fontSize: fontSizes.xs, lineHeight: 20 },
  code: { fontFamily: fonts.mono.regular, fontSize: 13, lineHeight: 20, paddingRight: spacing.md },
  eol: { color: colors.mutedForeground, fontSize: fontSizes.xs },
}));
