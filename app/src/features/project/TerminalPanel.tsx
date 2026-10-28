import { forwardRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { useRunner } from '../../state';
import { borderWidth, colors, radius, spacing } from '../../theme/tokens';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';

interface TerminalPanelProps {
  project: string;
  onFocusChange(focused: boolean): void;
}

export const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(function TerminalPanel({ project, onFocusChange }, ref) {
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text variant="label">Terminal</Text>
        {mode === 'remote' && (
          <Text variant="muted" numberOfLines={1} style={styles.note}>
            Remote isn't connected yet
          </Text>
        )}
        <View style={styles.toggle} accessibilityRole="radiogroup">
          {(['local', 'remote'] as const).map((m) => (
            <Pressable
              key={m}
              testID={`runner-${m}`}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === m }}
              onPress={() => setMode(m)}
              style={[styles.option, mode === m && styles.optionOn]}
            >
              <Text variant="label" style={{ color: mode === m ? colors.foreground : colors.mutedForeground }}>
                {m === 'local' ? 'Local' : 'Remote'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.body}>
        <TerminalPane ref={ref} project={project} onFocusChange={onFocusChange} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  panel: { flex: 1, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  note: { flex: 1, textAlign: 'right' },
  toggle: { flexDirection: 'row', backgroundColor: colors.secondary, borderRadius: radius.sm, padding: 2, marginLeft: 'auto' },
  option: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm - 2 },
  optionOn: { backgroundColor: colors.background },
  body: { flex: 1 },
});
