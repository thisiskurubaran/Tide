import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../../components/Text';
import { borderWidth, colors, radius, spacing } from '../../theme/tokens';
import { basename } from '../files/fs';

interface TabBarProps {
  open: string[];
  active: string | null;
  dirty: Set<string>;
  onSelect(path: string): void;
  onClose(path: string): void;
}

export function TabBar({ open, active, dirty, onSelect, onClose }: TabBarProps) {
  if (open.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content}>
      {open.map((path) => {
        const selected = path === active;
        return (
          <Pressable
            key={path}
            testID={`tab-${path}`}
            onPress={() => onSelect(path)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityHint={path}
            style={[styles.tab, selected && styles.selected]}
          >
            <Text variant="label" style={{ color: selected ? colors.foreground : colors.mutedForeground }} numberOfLines={1}>
              {basename(path)}
            </Text>
            <Pressable hitSlop={spacing.sm} onPress={() => onClose(path)} accessibilityLabel={`Close ${basename(path)}`}>
              {dirty.has(path) ? (
                <View style={styles.dirty} accessibilityLabel="Unsaved changes" testID={`dirty-${path}`} />
              ) : (
                <Feather name="x" size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, borderBottomWidth: borderWidth, borderColor: colors.border },
  content: { paddingHorizontal: spacing.sm },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 2,
    borderColor: 'transparent',
    maxWidth: 200,
  },
  selected: { borderColor: colors.brand },
  // Same footprint as the close icon so tabs don't shift when the dot appears.
  dirty: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 4, borderColor: colors.background, backgroundColor: colors.foreground },
});
