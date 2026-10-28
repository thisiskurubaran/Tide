import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { useRunner } from '../../state';
import { borderWidth, colors, radius, spacing } from '../../theme/tokens';

// Placeholder until the xterm.js terminal and mini-shell exist.
export function TerminalPanel() {
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text variant="label">Terminal</Text>
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
        <Text variant="mono" style={{ color: colors.mutedForeground }}>
          The terminal isn't available yet.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  toggle: { flexDirection: 'row', backgroundColor: colors.secondary, borderRadius: radius.sm, padding: 2 },
  option: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm - 2 },
  optionOn: { backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.md },
});
