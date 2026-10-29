import Feather from '@expo/vector-icons/Feather';
import { useEffect } from 'react';
import { Pressable } from 'react-native';

import { radius, spacing } from '../theme/tokens';
import { IconName } from './Button';
import { haptic } from './haptics';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { makeStyles, useColors } from '../theme/theme';

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
  const styles = useStyles();
  const colors = useColors();
  // Most menus open from a long press; a bump confirms it took.
  const open = title !== null;
  useEffect(() => {
    if (open) haptic('press');
  }, [open]);
  return (
    <Sheet visible={open} onClose={onClose} scrollable>
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

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
}));
