import { Icon } from '../../components/Icon';
import { ComponentRef, Ref } from 'react';
import { LayoutChangeEvent, Pressable, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { GlassSurface } from '../../components/Glass';
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
  // Where the first-run tour points: a ref and layout callback per item.
  targets?: Partial<Record<Activity, { ref: Ref<ComponentRef<typeof View>>; onLayout(e?: LayoutChangeEvent): void }>>;
}

// The row of views every desktop IDE has (VS Code's activity bar). On phones
// it sits at the bottom like a tab bar; on iPad it's a rail beside the files.
export function ActivityBar({ items, active, onSelect, vertical, bottomInset = 0, targets }: ActivityBarProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <GlassSurface
      color={colors.card}
      style={vertical ? styles.rail : [styles.bar, { paddingBottom: Math.max(bottomInset, 6) }]}
      accessibilityRole="tablist"
      testID="activity-bar"
    >
      {items.map((item) => {
        const on = item.id === active;
        const color = on ? colors.brand : colors.mutedForeground;
        return (
          <Pressable
            key={item.id}
            ref={targets?.[item.id]?.ref}
            onLayout={targets?.[item.id]?.onLayout}
            onPress={() => onSelect(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
            style={({ pressed }) => [vertical ? styles.railItem : styles.item, on && vertical && styles.railOn, pressed && styles.pressed]}
            testID={`activity-${item.id}`}
          >
            <View>
              <Icon name={item.icon} size={vertical ? 20 : 21} color={color} />
              {!!item.badge && (
                <View style={[styles.badge, { backgroundColor: item.alert ? colors.destructive : colors.brand }]}>
                  <Text style={styles.badgeText} allowFontScaling={false}>
                    {item.badge > 99 ? '99+' : item.badge}
                  </Text>
                </View>
              )}
            </View>
            {!vertical && (
              // Follows Dynamic Type all the way up; at the largest sizes a long
              // label wraps to a second line, then shrinks, instead of overflowing.
              <Text style={[styles.label, { color }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
                {item.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </GlassSurface>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 6,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
  },
  item: { flex: 1, alignItems: 'center', gap: 3, minHeight: 44, justifyContent: 'center' },
  rail: { width: 52, alignItems: 'center', paddingTop: 8, gap: 6, borderRightWidth: borderWidth, borderColor: colors.border },
  railItem: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  railOn: { backgroundColor: colors.brandSoft },
  pressed: { opacity: 0.6 },
  label: { fontFamily: fonts.sans.medium, fontSize: 11, textAlign: 'center' },
  badge: { position: 'absolute', top: -5, left: 12, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.brandForeground, fontFamily: fonts.sans.semibold, fontSize: 11 },
}));
