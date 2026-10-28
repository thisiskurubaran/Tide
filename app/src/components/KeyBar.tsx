import Feather from '@expo/vector-icons/Feather';
import { Fragment } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { borderWidth, fonts, fontSizes, radius, spacing } from '../theme/tokens';
import { IconName } from './Button';
import { Text } from './Text';
import { makeStyles, useColors } from '../theme/theme';

export const KEY_BAR_HEIGHT = 44;

export type KeyItem = { a11y: string; onPress(): void } & ({ label: string } | { icon: IconName });

interface KeyBarProps {
  // Groups are separated by a thin divider.
  groups: KeyItem[][];
  onHide(): void;
  testID?: string;
}

// Accessory row that sits on top of the software keyboard. Native buttons never
// take focus from the WebView, so the keyboard stays up while they are tapped.
export function KeyBar({ groups, onHide, testID }: KeyBarProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.bar} testID={testID}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys}>
        {groups.map((group, g) => (
          <Fragment key={g}>
            {g > 0 && <View style={styles.divider} />}
            {group.map((k) => (
              <Pressable key={k.a11y} accessibilityLabel={k.a11y} onPress={k.onPress} style={({ pressed }) => [styles.key, pressed && styles.pressed]}>
                {'icon' in k ? (
                  <Feather name={k.icon} size={16} color={colors.foreground} />
                ) : (
                  <Text style={styles.label}>{k.label}</Text>
                )}
              </Pressable>
            ))}
          </Fragment>
        ))}
      </ScrollView>
      <Pressable accessibilityLabel="Hide keyboard" onPress={onHide} style={({ pressed }) => [styles.hide, pressed && styles.pressed]}>
        <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    height: KEY_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
  },
  keys: { alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  key: {
    minWidth: 36,
    height: 32,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.secondary,
  },
  pressed: { backgroundColor: colors.border },
  label: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.md, color: colors.foreground },
  divider: { width: borderWidth, height: 20, backgroundColor: colors.border, marginHorizontal: spacing.xs },
  hide: {
    width: KEY_BAR_HEIGHT,
    height: KEY_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: borderWidth,
    borderColor: colors.border,
  },
}));
