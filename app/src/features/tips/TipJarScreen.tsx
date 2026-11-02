import Feather from '@expo/vector-icons/Feather';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';

import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { tipsStore, useTips } from '.';
import { TIPS } from './tips';

// Optional tips toward Tide's development. Nothing is unlocked by them.
export function TipJarScreen() {
  const styles = useStyles();
  const colors = useColors();
  const prices = useTips((s) => s.prices);
  const busy = useTips((s) => s.busy);
  const thanked = useTips((s) => s.thanked);
  const given = useTips((s) => s.given);
  const error = useTips((s) => s.error);
  useEffect(() => {
    tipsStore.getState().refresh().catch(() => undefined);
    return () => tipsStore.getState().dismiss();
  }, []);

  useEffect(() => {
    if (thanked) haptic('success');
  }, [thanked]);

  return (
    <Screen title="Support Tide" subtitle="Tide is free" testID="tip-jar">
      <View style={styles.hero}>
        <View style={[styles.heart, { backgroundColor: colors.brandSoft }]}>
          <Feather name="heart" size={28} color={colors.brand} />
        </View>
        <Text variant="muted" style={styles.center}>
          Every feature and extension in Tide is free. If Tide helps you get work done, a tip supports its development. Tips don't unlock anything.
        </Text>
      </View>

      {TIPS.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => tipsStore.getState().give(t.id)}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={`${t.title}, ${prices[t.id] ?? t.fallbackPrice}`}
          style={({ pressed }) => [styles.tip, pressed && { backgroundColor: colors.secondary }]}
          testID={`tip-${t.id}`}
        >
          <Text style={styles.emoji}>{t.emoji}</Text>
          <Text variant="label" style={styles.flex}>
            {t.title}
          </Text>
          {busy === t.id ? (
            <ActivityIndicator color={colors.mutedForeground} />
          ) : (
            <View style={[styles.price, { backgroundColor: colors.foreground }]}>
              <Text style={[styles.priceText, { color: colors.background }]} testID={`tip-${t.id}-price`}>
                {prices[t.id] ?? t.fallbackPrice}
              </Text>
            </View>
          )}
        </Pressable>
      ))}

      {thanked && (
        <View style={[styles.note, { backgroundColor: colors.brandSoft }]} accessibilityLiveRegion="polite" testID="tip-thanks">
          <Feather name="heart" size={18} color={colors.brand} />
          <Text style={styles.flex}>Thank you! Your support keeps Tide free for everyone.</Text>
        </View>
      )}
      {error && (
        <Pressable onPress={() => tipsStore.getState().dismiss()} style={[styles.note, { backgroundColor: colors.secondary }]} accessibilityRole="alert" testID="tip-error">
          <Text style={styles.flex}>{error}</Text>
          <Feather name="x" size={16} color={colors.mutedForeground} />
        </Pressable>
      )}

      <Text variant="muted" style={styles.center}>
        {given > 0 ? `You've left ${given} ${given === 1 ? 'tip' : 'tips'}. ` : ''}Tips are one-time purchases through {Platform.OS === 'android' ? 'Google Play' : 'the App Store'}.
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  heart: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  emoji: { fontSize: fontSizes.xl },
  price: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.md, minWidth: 72, alignItems: 'center' },
  priceText: { fontWeight: '600' },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
}));
