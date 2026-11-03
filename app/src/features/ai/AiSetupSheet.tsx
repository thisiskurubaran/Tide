import { useCallback, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { aiReady } from './client';
import { KeyForm, ProviderBadge } from './AiKeySheet';
import { PROVIDERS } from './providers/catalog';
import type { AiJob, ProviderId } from './providers/types';

const TILES: { provider: ProviderId; title: string; detail: string }[] = [
  { provider: 'anthropic', title: 'Anthropic', detail: 'Claude · recommended' },
  { provider: 'openai', title: 'OpenAI', detail: 'GPT models' },
  { provider: 'gemini', title: 'Google Gemini', detail: 'Gemini models' },
  { provider: 'openrouter', title: 'OpenRouter', detail: 'Many models, one key' },
  { provider: 'custom', title: 'Local (Ollama)', detail: 'Free, offline' },
];

interface AiSetupSheetProps {
  visible: boolean;
  onClose(): void;
  // Called once a provider is connected and tested.
  onReady?(): void;
}

// First use of an AI feature: pick a provider, paste a key, Save and test.
export function AiSetupSheet({ visible, onClose, onReady }: AiSetupSheetProps) {
  const styles = useStyles();
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  return (
    <Sheet visible={visible} onClose={onClose} scrollable>
      <Text variant="title">Set up AI</Text>
      <Text variant="muted">Use your own key. It stays in the iOS Keychain, and code goes straight from this device to the provider you pick; Tide has no server in between.</Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {TILES.map((t) => {
          const on = provider === t.provider;
          return (
            <Pressable
              key={t.provider}
              onPress={() => setProvider(t.provider)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.tile, on && styles.tileOn]}
              testID={`ai-setup-${t.provider}`}
            >
              <ProviderBadge provider={t.provider} size={24} />
              <View style={styles.tileText}>
                <Text variant="label" numberOfLines={1}>
                  {t.title}
                </Text>
                <Text variant="muted" numberOfLines={1}>
                  {t.detail}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text variant="muted">{PROVIDERS[provider].blurb}</Text>
      <KeyForm
        provider={provider}
        onSaved={() => {
          onReady?.();
          onClose();
        }}
        secondary={{ title: 'Not now', onPress: onClose }}
        testID="ai-setup-key"
      />
    </Sheet>
  );
}

// For features that need AI: `ensure(job, then)` runs `then` right away when
// the job is set up, or shows the setup sheet and runs it once it is.
// Render `sheet` somewhere in the component.
export function useAiSetup() {
  const [visible, setVisible] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const ensure = useCallback((job: AiJob, then?: () => void) => {
    if (aiReady(job)) {
      then?.();
      return true;
    }
    pending.current = then ?? null;
    setVisible(true);
    return false;
  }, []);
  const open = useCallback(() => setVisible(true), []);
  const sheet = (
    <AiSetupSheet
      visible={visible}
      onClose={() => {
        setVisible(false);
        pending.current = null;
      }}
      onReady={() => {
        const then = pending.current;
        pending.current = null;
        // After the sheet closes, so a following sheet can open.
        if (then) setTimeout(then, 350);
      }}
    />
  );
  return { ensure, open, sheet };
}

const useStyles = makeStyles((colors) => ({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  tileOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  tileText: { flex: 1, gap: 1 },
}));
