import Feather from '@expo/vector-icons/Feather';
import { ComponentProps, useState } from 'react';
import { Pressable, View } from 'react-native';

import { borderWidth, fonts, fontSizes, radius, spacing } from '../theme/tokens';
import { Text } from './Text';
import { makeStyles, useColors } from '../theme/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

interface ButtonProps {
  title: string;
  onPress(): void;
  variant?: 'primary' | 'outline';
  icon?: IconName;
  disabled?: boolean;
  testID?: string;
}

// FuseOps buttons: primary is foreground on background, outline sits on a card.
export function Button({ title, onPress, variant = 'primary', icon, disabled, testID }: ButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  const primary = variant === 'primary';
  const color = primary ? colors.background : colors.foreground;
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : styles.outline,
        hovered && !disabled && styles.hovered,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      {icon && <Feather name={icon} size={16} color={color} />}
      <Text style={[styles.title, { color }]}>{title}</Text>
    </Pressable>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onPress(): void;
  color?: string;
  disabled?: boolean;
  testID?: string;
}

export function IconButton({ icon, label, onPress, color, disabled, testID }: IconButtonProps) {
  const styles = useStyles();
  const colors = useColors();
  // iPad pointer and Mac: a hover highlight, like desktop toolbars.
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={spacing.sm}
      style={({ pressed }) => [styles.icon, (pressed || (hovered && !disabled)) && { backgroundColor: colors.secondary }, disabled && styles.dimmed]}
    >
      <View>
        <Feather name={icon} size={18} color={color ?? colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    // A minimum rather than a fixed height, so larger text sizes don't clip the title.
    minHeight: 44,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md + 4,
    borderRadius: radius.md,
    borderWidth,
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.foreground },
  outline: { backgroundColor: colors.card, borderColor: colors.border },
  dimmed: { opacity: 0.6 },
  hovered: { opacity: 0.88 },
  title: { fontFamily: fonts.sans.medium, fontSize: fontSizes.sm },
  icon: { padding: spacing.xs + 3, borderRadius: radius.sm },
}));
