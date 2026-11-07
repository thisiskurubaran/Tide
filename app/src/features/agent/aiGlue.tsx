// The few places the agent's screens touch the AI settings: the model chip,
// the cost estimate and the first-use setup sheet.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { makeStyles } from '../../theme/theme';
import { fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { Usage } from '../ai/client';
import { modelLabel } from '../ai/providers/catalog';
import { useAiSettings } from '../ai/settings';
import { costOf, formatUsd } from '../ai/usage';

export const formatCost = formatUsd;

export const useAgentModel = () => useAiSettings((s) => s.jobs.agent);

// Dollars for this usage on the agent's model, or null when the price isn't known.
export function useCostEstimate(usage: Usage): number | null {
  const ref = useAgentModel();
  if (!usage.inputTokens && !usage.outputTokens) return null;
  return costOf(ref.provider, ref.model, usage);
}

export function ModelChip() {
  const styles = useStyles();
  const ref = useAgentModel();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Model: ${modelLabel(ref.model)}. Change in AI settings`} onPress={() => router.push('/settings/ai')} style={styles.chip} testID="agent-model">
      <Text style={styles.text} numberOfLines={1}>
        {modelLabel(ref.model) || 'No model'}
      </Text>
    </Pressable>
  );
}

// First use: the AI feature's own setup sheet (pick a provider, paste a key).
export { useAiSetup } from '../ai/AiSetupSheet';

export function AgentSetup({ onPress }: { onPress(): void }) {
  const styles = useStyles();
  return (
    <View style={styles.setup}>
      <Button title="Set up AI" icon="key" onPress={onPress} testID="agent-setup" />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  chip: { maxWidth: 150, borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: spacing.sm + 2, paddingVertical: 3 },
  text: { color: colors.brand, fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  setup: { alignItems: 'flex-start' },
}));
