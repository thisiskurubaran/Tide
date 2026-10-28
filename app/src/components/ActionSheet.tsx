import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';
import { IconName } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface Action {
  label: string;
  icon: IconName;
  destructive?: boolean;
  onPress(): void;
}

interface ActionSheetProps {
  title: string | null;
  actions: Action[];
  onClose(): void;
}

// Cross-platform action menu; Android's Alert caps out at three buttons.
export function ActionSheet({ title, actions, onClose }: ActionSheetProps) {
  return (
    <Sheet visible={title !== null} onClose={onClose}>
      <Text variant="muted" numberOfLines={1}>
        {title}
      </Text>
      {actions.map((a) => {
        const color = a.destructive ? colors.destructive : colors.foreground;
        return (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              a.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
          >
            <Feather name={a.icon} size={18} color={color} />
            <Text style={{ color }}>{a.label}</Text>
          </Pressable>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
});
