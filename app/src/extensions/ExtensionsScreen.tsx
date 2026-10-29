import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../components/Button';
import type { IconName } from '../components/Button';
import { Text } from '../components/Text';
import { makeStyles, useColors } from '../theme/theme';
import { borderWidth, radius, spacing } from '../theme/tokens';
import { ExtensionManifest, manifests } from './manifests';
import { extensionsStore, useExtensions } from './state';
import { isActive } from './store';
import { ThemePicker } from './themes/ThemePicker';

// The marketplace: every extension with its price, what it does, and a buy,
// enable or settings control. Purchases are per extension; there is no bundle.
export function ExtensionsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const error = useExtensions((s) => s.error);
  const busy = useExtensions((s) => s.busy);
  const store = extensionsStore.getState();

  useEffect(() => {
    store.refresh().catch(() => undefined);
  }, [store]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <Text variant="title" style={styles.title}>
          Extensions
        </Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text variant="muted">Each extension is a one-time purchase and works on all your devices signed in to the same store account.</Text>
        {error && (
          <Pressable onPress={() => store.clearError()} style={styles.error} accessibilityRole="alert" testID="extensions-error">
            <Text variant="error" style={styles.flex}>
              {error}
            </Text>
            <Feather name="x" size={16} />
          </Pressable>
        )}
        {manifests.map((m) => (
          <ExtensionCard key={m.id} manifest={m} />
        ))}
        <Button
          title={busy === 'restore' ? 'Restoring...' : 'Restore purchases'}
          variant="outline"
          icon="rotate-ccw"
          onPress={() => store.restore()}
          disabled={busy !== null}
          testID="restore"
        />
      </ScrollView>
    </View>
  );
}

function ExtensionCard({ manifest: m }: { manifest: ExtensionManifest }) {
  const styles = useStyles();
  const colors = useColors();
  const owned = useExtensions((s) => s.owned.includes(m.id));
  const active = useExtensions((s) => isActive(s, m.id));
  const price = useExtensions((s) => s.prices[m.id] ?? m.fallbackPrice);
  const busy = useExtensions((s) => s.busy);
  const [expanded, setExpanded] = useState(false);
  const store = extensionsStore.getState();

  return (
    <View style={styles.card} testID={`ext-${m.id}`}>
      <Pressable onPress={() => setExpanded((e) => !e)} style={styles.cardHead} accessibilityRole="button" accessibilityState={{ expanded }}>
        <View style={[styles.icon, { backgroundColor: colors.brandSoft }]}>
          <Feather name={m.icon as IconName} size={20} color={colors.brand} />
        </View>
        <View style={styles.flex}>
          <Text variant="label">{m.name}</Text>
          <Text variant="muted">{m.tagline}</Text>
        </View>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </Pressable>

      {expanded && (
        <View style={styles.features}>
          {m.features.map((f) => (
            <View key={f} style={styles.feature}>
              <Feather name="check" size={14} color={colors.success} style={styles.check} />
              <Text variant="muted" style={styles.flex}>
                {f}
              </Text>
            </View>
          ))}
          {m.note && <Text variant="muted">{m.note}</Text>}
        </View>
      )}

      <View style={styles.actions}>
        {owned ? (
          <>
            <Text variant="muted" style={styles.flex}>
              {active ? 'Installed' : 'Turned off'}
            </Text>
            <Switch testID={`ext-${m.id}-enabled`} value={active} onValueChange={(v) => store.setEnabled(m.id, v)} />
          </>
        ) : (
          <>
            <Text variant="label" style={styles.flex} testID={`ext-${m.id}-price`}>
              {price}
            </Text>
            {busy === m.id ? (
              <ActivityIndicator />
            ) : (
              <Button title="Buy" icon="shopping-bag" onPress={() => store.buy(m.id)} disabled={busy !== null} testID={`ext-${m.id}-buy`} />
            )}
          </>
        )}
      </View>
      {active && <ExtensionSettings manifest={m} />}
    </View>
  );
}

// Settings for an installed extension, under its card.
function ExtensionSettings({ manifest: m }: { manifest: ExtensionManifest }) {
  const styles = useStyles();
  const prefs = useExtensions((s) => s.prefs);
  const [picker, setPicker] = useState(false);
  const { setPref } = extensionsStore.getState();
  if (m.id === 'themes') {
    return (
      <View style={styles.settings}>
        <Button title="Choose color theme" variant="outline" icon="droplet" onPress={() => setPicker(true)} testID="choose-theme" />
        <ThemePicker visible={picker} onClose={() => setPicker(false)} />
      </View>
    );
  }
  if (m.id === 'format-lint') {
    return (
      <View style={styles.settings}>
        <SettingSwitch label="Format on save" value={prefs.formatOnSave} onChange={(v) => setPref('formatOnSave', v)} testID="format-on-save" />
        <SettingSwitch label="Lint as you type" value={prefs.lintAsYouType} onChange={(v) => setPref('lintAsYouType', v)} testID="lint-as-you-type" />
      </View>
    );
  }
  return null;
}

function SettingSwitch({ label, value, onChange, testID }: { label: string; value: boolean; onChange(v: boolean): void; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.settingRow}>
      <Text style={styles.flex}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onChange} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  title: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.md },
  flex: { flex: 1 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.destructiveSoft,
  },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth, borderColor: colors.border, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  icon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  features: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  feature: { flexDirection: 'row', gap: spacing.sm },
  check: { marginTop: 3 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
    minHeight: 56,
  },
  settings: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  settingRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
}));
