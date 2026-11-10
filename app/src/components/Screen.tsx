import { Icon } from './Icon';
import { router } from 'expo-router';
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles, useColors } from '../theme/theme';
import { borderWidth, radius, spacing } from '../theme/tokens';
import { IconButton } from './Button';
import type { IconName } from './Button';
import { Text } from './Text';

interface ScreenProps {
  title: string;
  subtitle?: string;
  // Buttons on the right of the header.
  actions?: ReactNode;
  children: ReactNode;
  // Off for screens that lay out their own scrolling (lists, web views).
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
}

// A pushed screen: back button, title and actions, then the content.
export function Screen({ title, subtitle, actions, children, scroll = true, onRefresh, refreshing = false, testID }: ScreenProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID={testID}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <View style={styles.titles}>
          <Text variant="title" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text variant="muted" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {actions}
      </View>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, { paddingBottom: insets.bottom }]}>{children}</View>
      )}
    </View>
  );
}

interface ListRowProps {
  title: string;
  subtitle?: string;
  detail?: string;
  icon?: IconName;
  iconColor?: string;
  right?: ReactNode;
  onPress?: () => void;
  testID?: string;
}

// A tappable card row in a list: icon, title, a muted line or two, and a chevron.
export function ListRow({ title, subtitle, detail, icon, iconColor, right, onPress, testID }: ListRowProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={testID}>
      {icon && <Icon name={icon} size={18} color={iconColor ?? colors.mutedForeground} style={styles.rowIcon} />}
      <View style={styles.rowText}>
        <Text variant="label" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
        {detail ? (
          <Text variant="muted" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && <Icon name="chevron-right" size={18} color={colors.mutedForeground} />}
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.mutedForeground} />
      {label ? <Text variant="muted">{label}</Text> : null}
    </View>
  );
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text variant="label">{title}</Text>
      {body ? (
        <Text variant="muted" style={styles.center}>
          {body}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.badge, { borderColor: color ?? colors.border }]}>
      <Text variant="muted" style={{ color: color ?? colors.mutedForeground }}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  titles: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  rowIcon: { alignSelf: 'flex-start', marginTop: 2 },
  rowText: { flex: 1, gap: 2 },
  loading: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  empty: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  center: { textAlign: 'center' },
  badge: { borderWidth, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 1 },
}));
