import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, View } from 'react-native';

import type { Command } from '../features/search/CommandPalette';
import { Sheet } from '../components/Sheet';
import { Text } from '../components/Text';
import { makeStyles, useColors } from '../theme/theme';
import { radius, spacing } from '../theme/tokens';
import { Diagnostic, fileDiagnostics, useDiagnostics } from './diagnostics';
import type { Panel, PanelProps, ProjectContext } from './types';

// Every warning and error the extensions reported for the project's files.
// Shared by Format & Lint and IntelliSense; the host shows it once.
export function ProblemsPanel({ ctx, visible, onClose }: PanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const files = useDiagnostics((s) => s.byProject[ctx.project]);
  const state = useDiagnostics((s) => s);
  const paths = Object.keys(files ?? {}).sort();
  const icon = (d: Diagnostic) =>
    d.severity === 'error' ? (
      <Feather name="x-circle" size={14} color={colors.destructive} />
    ) : d.severity === 'warning' ? (
      <Feather name="alert-triangle" size={14} color={colors.warning} />
    ) : (
      <Feather name="info" size={14} color={colors.brand} />
    );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">Problems</Text>
      <ScrollView style={styles.list}>
        {paths.length === 0 && <Text variant="muted">No problems in open files.</Text>}
        {paths.map((path) => (
          <View key={path} style={styles.file}>
            <Text variant="label">{path}</Text>
            {fileDiagnostics(state, ctx.project, path).map((d, i) => (
              <Pressable accessibilityRole="button"
                key={`${d.source}-${d.from}-${i}`}
                testID={`problem-${path}-${d.line}`}
                onPress={() => {
                  onClose();
                  ctx.openFile(path, d.line, d.column);
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
              >
                <View style={styles.icon}>{icon(d)}</View>
                <Text style={styles.message}>{d.message}</Text>
                <Text variant="muted">
                  {d.line}:{d.column}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

export const problemsPanel: Panel = { id: 'problems', component: ProblemsPanel };

export const problemsCommand = (ctx: ProjectContext): Command => ({
  id: 'problems',
  title: 'Show problems',
  icon: 'alert-triangle',
  run: () => ctx.openPanel('problems'),
});

const useStyles = makeStyles(() => ({
  list: { maxHeight: 480 },
  file: { gap: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  icon: { paddingTop: 3 },
  message: { flex: 1, fontSize: 14 },
}));
