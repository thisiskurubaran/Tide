import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { announce } from '../../components/a11y';
import { Button, IconButton } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { proStore, useProState } from './index';
import { PRIVACY_URL, renewalTerms, TERMS_URL } from './legal';
import { PlanId, PLANS, PRO_FEATURES, ProFeature } from './plans';
import { isPro, proStatus } from './store';

const FEATURE_ORDER: ProFeature[] = ['remote', 'linked-folders', 'compare', 'tests', 'devtools', 'extensions', 'split-editor', 'terminals', 'snapshots'];

// The Tide Pro paywall: what Pro adds, the three plans, and Apple's
// required terms and links. Opened from Settings, the Extensions screen and
// any Pro feature (which it names at the top).
export function ProScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { feature } = useLocalSearchParams<{ feature?: ProFeature }>();
  const prices = useProState((s) => s.prices);
  const trial = useProState((s) => s.trial);
  const busy = useProState((s) => s.busy);
  const error = useProState((s) => s.error);
  const pro = useProState((s) => isPro(s));
  const status = useProState((s) => proStatus(s));
  const subscribed = useProState((s) => s.subscription !== null && !s.lifetime);
  const [plan, setPlan] = useState<PlanId>('yearly');
  const store = proStore.getState();

  useEffect(() => {
    proStore.getState().refresh().catch(() => undefined);
    return () => proStore.getState().clearError();
  }, []);

  const price = (id: PlanId) => prices[id] ?? PLANS.find((p) => p.id === id)!.fallbackPrice;
  const highlighted = feature && PRO_FEATURES[feature] ? PRO_FEATURES[feature] : null;

  async function buy() {
    if (await store.buy(plan)) {
      haptic('success');
      announce('Tide Pro is on. Thank you!');
      router.back();
    }
  }

  async function restore() {
    if (await store.restore()) {
      haptic('success');
      announce('Tide Pro restored');
      router.back();
    }
  }

  const open = (url: string) => {
    if (!url) {
      Alert.alert('Privacy Policy', 'This build has no privacy policy link. Set EXPO_PUBLIC_PRIVACY_URL when building.');
      return;
    }
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="x" label="Close" onPress={() => router.back()} testID="pro-close" />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Feather name="star" size={28} color={colors.brand} />
          </View>
          <Text variant="heading">Tide Pro</Text>
          <Text variant="muted" style={styles.center}>
            {pro ? `You have Tide Pro${status ? `: ${status}` : ''}. Thank you!` : 'Everything in Tide, for serious work on iPhone and iPad.'}
          </Text>
        </View>

        {highlighted && !pro && (
          <View style={styles.needs} testID="pro-needs">
            <Feather name={highlighted.icon} size={18} color={colors.brand} />
            <Text style={styles.flex}>
              <Text variant="label">{highlighted.title}</Text> is part of Tide Pro.
            </Text>
          </View>
        )}

        <View style={styles.features}>
          {FEATURE_ORDER.map((id) => {
            const f = PRO_FEATURES[id];
            return (
              <View key={id} style={styles.feature}>
                <Feather name={f.icon} size={18} color={colors.brand} style={styles.featureIcon} />
                <View style={styles.flex}>
                  <Text variant="label">{f.title}</Text>
                  <Text variant="muted">{f.description}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {pro ? (
          subscribed && <Button title="Manage subscription" variant="outline" icon="settings" onPress={() => store.manage().catch(() => undefined)} testID="pro-manage" />
        ) : (
          <>
            <View style={styles.plans} accessibilityRole="radiogroup">
              {PLANS.map((p) => {
                const selected = p.id === plan;
                const note = p.id === 'yearly' ? (trial ? `${trial} free` : 'Best value') : p.id === 'lifetime' ? 'Pay once' : null;
                return (
                  <Pressable
                    key={p.id}
                    testID={`plan-${p.id}`}
                    onPress={() => setPlan(p.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${p.title}, ${price(p.id)} ${p.per}${note ? `, ${note}` : ''}`}
                    style={[styles.plan, selected && { borderColor: colors.brand, backgroundColor: colors.brandSoft }]}
                  >
                    <Feather name={selected ? 'check-circle' : 'circle'} size={20} color={selected ? colors.brand : colors.mutedForeground} />
                    <View style={styles.flex}>
                      <Text variant="label">{p.title}</Text>
                      <Text variant="muted">
                        {price(p.id)} {p.per}
                      </Text>
                    </View>
                    {note && (
                      <View style={[styles.pill, { backgroundColor: selected ? colors.brand : colors.secondary }]}>
                        <Text style={[styles.pillText, { color: selected ? colors.background : colors.foreground }]}>{note}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {error && (
              <Text variant="error" accessibilityRole="alert" testID="pro-error">
                {error}
              </Text>
            )}

            {busy && busy !== 'restore' ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Button
                title={plan === 'yearly' && trial ? `Start ${trial} free trial` : plan === 'lifetime' ? `Buy for ${price('lifetime')}` : 'Subscribe'}
                onPress={buy}
                disabled={busy !== null}
                testID="pro-buy"
              />
            )}
            <Text variant="muted" style={styles.terms} testID="pro-terms">
              {renewalTerms(plan, price(plan), plan === 'yearly' ? trial : null)}
            </Text>
          </>
        )}

        <View style={styles.links}>
          <Pressable onPress={restore} accessibilityRole="button" disabled={busy !== null} testID="pro-restore">
            <Text style={styles.link}>{busy === 'restore' ? 'Restoring...' : 'Restore purchases'}</Text>
          </Pressable>
          <Pressable onPress={() => open(TERMS_URL)} accessibilityRole="link" testID="pro-terms-link">
            <Text style={styles.link}>Terms of Use</Text>
          </Pressable>
          <Pressable onPress={() => open(PRIVACY_URL)} accessibilityRole="link" testID="pro-privacy-link">
            <Text style={styles.link}>Privacy Policy</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  content: { paddingHorizontal: spacing.lg, gap: spacing.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', gap: spacing.sm },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandSoft },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  needs: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  features: { gap: spacing.md },
  feature: { flexDirection: 'row', gap: spacing.md },
  featureIcon: { marginTop: 2 },
  plans: { gap: spacing.sm },
  plan: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 2 * borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontSize: 12 },
  terms: { fontSize: 12, lineHeight: 17 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.lg },
  link: { color: colors.brand, fontSize: 14 },
}));
