import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import { Diagnostic, fileDiagnostics, useDiagnostics } from '../../extensions/diagnostics';

interface ProblemsPanelProps {
  project: string;
  visible: boolean;
  onOpen(path: string, line: number, column: number): void;
  onClose(): void;
  // Sends the last error in the terminal to the AI assistant.
  onExplainError?(): void;
}

// Every error and warning Tide knows about in the project: from the editor's
// language services, the extensions (lint, type errors) and program output.
export function ProblemsPanel({ project, visible, onOpen, onClose, onExplainError }: ProblemsPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const files = useDiagnostics((s) => s.byProject[project]);
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
        {paths.length === 0 && <Text variant="muted">No problems found. Errors from the editor, extensions and programs you run show up here.</Text>}
        {paths.map((path) => (
          <View key={path} style={styles.file}>
            <Text variant="label">{path}</Text>
            {fileDiagnostics(state, project, path).map((d, i) => (
              <Pressable accessibilityRole="button"
                key={`${d.source}-${d.from}-${i}`}
                testID={`problem-${path}-${d.line}`}
                onPress={() => {
                  onClose();
                  onOpen(path, d.line, d.column);
                }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
              >
                <View style={styles.icon}>{icon(d)}</View>
                <Text style={styles.message}>{d.message}</Text>
                <Text variant="muted">
                  {d.source} {d.line}:{d.column}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      {onExplainError && (
        <Button
          title="Explain the last error with AI"
          variant="outline"
          icon="cpu"
          onPress={() => {
            onClose();
            onExplainError();
          }}
          testID="problems-explain"
        />
      )}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 480 },
  file: { gap: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  icon: { paddingTop: 3 },
  message: { flex: 1, fontSize: 14 },
}));
