import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts } from '../../theme/tokens';

export type Activity = 'files' | 'search' | 'git' | 'terminal' | 'problems' | 'more';

export interface ActivityItem {
  id: Activity;
  label: string;
  icon: IconName;
  badge?: number;
  // Red badge (problems) rather than the brand color (changes).
  alert?: boolean;
}

interface ActivityBarProps {
  items: ActivityItem[];
  active: Activity | null;
  onSelect(id: Activity): void;
  // iPad: a rail down the left edge instead of tabs along the bottom.
  vertical?: boolean;
  bottomInset?: number;
}

// The row of views every desktop IDE has (VS Code's activity bar). On phones
// it sits at the bottom like a tab bar; on iPad it's a rail beside the files.
export function ActivityBar({ items, active, onSelect, vertical, bottomInset = 0 }: ActivityBarProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={vertical ? styles.rail : [styles.bar, { paddingBottom: Math.max(bottomInset, 6) }]} accessibilityRole="tablist" testID="activity-bar">
      {items.map((item) => {
        const on = item.id === active;
        const color = on ? colors.brand : colors.mutedForeground;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
            style={({ pressed }) => [vertical ? styles.railItem : styles.item, on && vertical && styles.railOn, pressed && styles.pressed]}
            testID={`activity-${item.id}`}
          >
            <View>
              <Feather name={item.icon} size={vertical ? 20 : 21} color={color} />
              {!!item.badge && (
                <View style={[styles.badge, { backgroundColor: item.alert ? colors.destructive : colors.brand }]}>
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </Text>
                </View>
              )}
            </View>
            {!vertical && (
              <Text style={[styles.label, { color }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {item.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 6,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  item: { flex: 1, alignItems: 'center', gap: 3, minHeight: 44, justifyContent: 'center' },
  rail: { width: 52, alignItems: 'center', paddingTop: 8, gap: 6, borderRightWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  railItem: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  railOn: { backgroundColor: colors.brandSoft },
  pressed: { opacity: 0.6 },
  label: { fontFamily: fonts.sans.medium, fontSize: 10 },
  badge: { position: 'absolute', top: -5, left: 12, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.background, fontFamily: fonts.sans.semibold, fontSize: 10 },
}));
