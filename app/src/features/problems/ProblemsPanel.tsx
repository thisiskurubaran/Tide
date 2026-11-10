import { Icon } from '../../components/Icon';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { fonts, radius, spacing } from '../../theme/tokens';
import { Diagnostic, fileDiagnostics, useDiagnostics } from '../../extensions/diagnostics';
import { FixRequest, FixSheet } from './FixSheet';

interface ProblemsPanelProps {
  project: string;
  visible: boolean;
  onOpen(path: string, line: number, column: number): void;
  onClose(): void;
  // Sends the last error in the terminal to the AI assistant.
  onExplainError?(): void;
  // Opens a fix for a problem or a file. Without it the panel shows its own Fix sheet.
  onFix?(request: FixRequest): void;
}

// Problems from program output (the last run) rather than from a checker:
// the output collector publishes them under "output:<terminal>".
const outputItems = (sources: Record<string, Diagnostic[]> | undefined) =>
  new Set(
    Object.entries(sources ?? {})
      .filter(([k]) => k.startsWith('output:'))
      .flatMap(([, v]) => v),
  );

// Every error and warning Tide knows about in the project: from the editor's
// language services, the extensions (lint, type errors) and program output.
export function ProblemsPanel({ project, visible, onOpen, onClose, onExplainError, onFix }: ProblemsPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [fixing, setFixing] = useState<FixRequest | null>(null);
  const fix = (request: FixRequest) => {
    onClose();
    if (onFix) onFix(request);
    else setFixing(request);
  };
  const files = useDiagnostics((s) => s.byProject[project]);
  const state = useDiagnostics((s) => s);
  const paths = Object.keys(files ?? {}).sort();
  const icon = (d: Diagnostic) =>
    d.severity === 'error' ? (
      <Icon name="x-circle" size={14} color={colors.destructive} />
    ) : d.severity === 'warning' ? (
      <Icon name="alert-triangle" size={14} color={colors.warning} />
    ) : (
      <Icon name="info" size={14} color={colors.brand} />
    );

  return (
    <>
      <Sheet visible={visible} onClose={onClose}>
        <Text variant="title">Problems</Text>
        <ScrollView style={styles.list}>
          {paths.length === 0 && <Text variant="muted">No problems found. Errors from the editor, extensions and programs you run show up here.</Text>}
          {paths.map((path) => {
            const fromRun = outputItems(files?.[path]);
            return (
              <View key={path} style={styles.file}>
                <View style={styles.fileHeader}>
                  <Text variant="label" style={styles.message}>
                    {path}
                  </Text>
                  {fileDiagnostics(state, project, path).some((d) => d.severity !== 'info') && (
                    <FixButton label="✦ Fix all in file" onPress={() => fix({ kind: 'file', path })} testID={`problem-fix-file-${path}`} />
                  )}
                </View>
                {fileDiagnostics(state, project, path).map((d, i) => (
                  <View key={`${d.source}-${d.from}-${i}`} style={styles.rowWrap}>
                    <Pressable
                      accessibilityRole="button"
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
                    <FixButton
                      label={fromRun.has(d) ? '✦ Explain & fix' : '✦ Fix'}
                      onPress={() => fix({ kind: 'problem', path, line: d.line })}
                      testID={`problem-fix-${path}-${d.line}`}
                    />
                  </View>
                ))}
              </View>
            );
          })}
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
      {!onFix && <FixSheet project={project} request={fixing} onClose={() => setFixing(null)} />}
    </>
  );
}

function FixButton({ label, onPress, testID }: { label: string; onPress(): void; testID: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label.replace('✦ ', '') + ' with AI'}
      onPress={onPress}
      hitSlop={6}
      testID={testID}
      style={({ pressed }) => [styles.fix, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.fixText, { color: colors.brand }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { maxHeight: 480 },
  file: { gap: spacing.xs, marginBottom: spacing.md },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  fix: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1,
    marginTop: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  fixText: { fontSize: 12, fontFamily: fonts.sans.medium },
  icon: { paddingTop: 3 },
  message: { flex: 1, fontSize: 14 },
}));
