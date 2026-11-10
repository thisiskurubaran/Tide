import { Icon } from '../../components/Icon';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Switch, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { commandApprovals } from '../agent/approvalsStore';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { AiKeySheet, ProviderBadge } from './AiKeySheet';
import { isClaudeModel, JOB_LABELS, modelLabel, PROVIDER_ORDER, PROVIDERS } from './providers/catalog';
import type { AiJob, ModelRef, ProviderId } from './providers/types';
import { aiSettings, useAiSettings } from './settings';
import { formatTokens, formatUsd, totalsOf, useUsage } from './usage';

const JOBS: AiJob[] = ['agent', 'chat', 'complete'];
const LIMITS: (number | null)[] = [5, 10, 25, 50, null];
const TOKEN_LIMITS: (number | null)[] = [1_000_000, 2_000_000, 10_000_000, 50_000_000, null];

// Providers and keys, the model for each job, inline completions, and
// what this month cost against the spend limit.
export function AiSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const connected = useAiSettings((s) => s.connected);
  const jobs = useAiSettings((s) => s.jobs);
  const completions = useAiSettings((s) => s.completions);
  const [keySheet, setKeySheet] = useState<ProviderId | null>(null);
  const [picker, setPicker] = useState<AiJob | null>(null);

  return (
    <Screen title="AI assistant" subtitle="Your own key, your choice of model" testID="ai-settings">
      <Text variant="muted" style={styles.intro}>
        Your key stays in the iOS Keychain. Code goes straight from this device to the provider you pick; Tide has no server in between.
      </Text>

      <Section title="PROVIDERS">
        {PROVIDER_ORDER.map((p) => (
          <Pressable key={p} onPress={() => setKeySheet(p)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`ai-provider-${p}`}>
            <ProviderBadge provider={p} />
            <View style={styles.rowText}>
              <Text variant="label">{PROVIDERS[p].name}</Text>
              <Text variant="muted" numberOfLines={1} style={styles.detail}>
                {PROVIDERS[p].blurb}
              </Text>
            </View>
            {connected[p] ? (
              <Text variant="label" style={{ color: colors.success }} testID={`ai-provider-${p}-connected`}>
                Connected ✓
              </Text>
            ) : (
              <Text variant="label" style={{ color: colors.brand }}>
                {p === 'custom' ? 'Add server ›' : 'Add key ›'}
              </Text>
            )}
          </Pressable>
        ))}
      </Section>

      <Section title="MODEL FOR EACH JOB">
        {JOBS.map((job) => {
          const ref = jobs[job];
          const ok = !!connected[ref.provider] && !!ref.model;
          return (
            <Pressable key={job} onPress={() => setPicker(job)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID={`ai-job-${job}`}>
              <View style={styles.rowText}>
                <Text variant="label">{JOB_LABELS[job]}</Text>
                <Text variant="muted" numberOfLines={1} style={[styles.detail, !ok && { color: colors.warning }]}>
                  {ref.model ? `${modelLabel(ref.model)} · ${PROVIDERS[ref.provider].name}` : 'Pick a model'}
                  {ref.model && !ok ? ' (not connected)' : ''}
                </Text>
              </View>
              <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
            </Pressable>
          );
        })}
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text variant="label">Show inline completions</Text>
            <Text variant="muted" style={styles.detail}>
              Suggestions as you type; Tab accepts
            </Text>
          </View>
          <Switch
            value={completions}
            onValueChange={(on) => aiSettings.getState().setCompletions(on)}
            trackColor={{ true: colors.brand, false: colors.secondary }}
            testID="ai-completions"
          />
        </View>
      </Section>

      <MonthCard />

      <AgentApprovals />

      <AiKeySheet provider={keySheet} onClose={() => setKeySheet(null)} />
      <ModelPicker job={picker} onClose={() => setPicker(null)} onAddProvider={(p) => (setPicker(null), setKeySheet(p))} />
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text variant="muted" style={styles.sectionTitle}>
        {title}
      </Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

// "Always allow" answers the agent was given for commands, per project.
function AgentApprovals() {
  const styles = useStyles();
  const colors = useColors();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    commandApprovals.count().then(setCount, () => setCount(0));
  }, []);
  const reset = () =>
    Alert.alert('Reset command approvals?', 'The agent will ask again before running commands you had allowed always, in every project.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          await commandApprovals.clearAll();
          setCount(0);
          haptic('success');
        },
      },
    ]);
  return (
    <Section title="AGENT">
      <Pressable onPress={reset} disabled={!count} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.pressed]} testID="ai-reset-approvals">
        <View style={styles.rowText}>
          <Text variant="label" style={{ color: count ? colors.destructive : colors.mutedForeground }}>
            Reset command approvals
          </Text>
          <Text variant="muted" style={styles.detail} testID="ai-approvals-count">
            {count === null ? ' ' : count === 0 ? 'No commands are always allowed' : `${count} always allowed`}
          </Text>
        </View>
      </Pressable>
    </Section>
  );
}

function MonthCard() {
  const styles = useStyles();
  const colors = useColors();
  const limit = useAiSettings((s) => s.monthlyLimitUsd);
  const tokenLimit = useAiSettings((s) => s.unpricedTokenLimit);
  const month = useUsage((s) => s.month);
  const byModel = useUsage((s) => s.byModel);
  const [other, setOther] = useState('');
  // A new month shows as empty until something is used in it.
  const current = useMemo(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return key === month ? Object.values(byModel) : [];
  }, [month, byModel]);
  const totals = totalsOf(current);
  const share = limit ? Math.min(1, totals.costUsd / limit) : 0;
  const reached = limit !== null && totals.costUsd >= limit;
  return (
    <Section title="THIS MONTH">
      <View style={styles.month} testID="ai-usage">
        <View style={styles.stats}>
          <View style={styles.stat}>
            <Text variant="muted">Tokens</Text>
            <Text style={styles.big} testID="ai-usage-tokens">
              {formatTokens(totals.inputTokens + totals.outputTokens)}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text variant="muted">Estimated cost</Text>
            <Text style={styles.big} testID="ai-usage-cost">
              {formatUsd(totals.costUsd)}
            </Text>
          </View>
        </View>
        {limit !== null && (
          <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
            <View style={[styles.fill, { width: `${Math.max(share * 100, totals.costUsd > 0 ? 2 : 0)}%` }, reached && { experimental_backgroundImage: undefined, backgroundColor: colors.destructive }]} />
          </View>
        )}
        <Text variant={reached ? 'error' : 'muted'}>
          {limit === null
            ? 'No spending limit.'
            : reached
              ? `Limit of ${formatUsd(limit)} reached. AI features pause until next month or a higher limit.`
              : `${formatUsd(Math.max(0, limit - totals.costUsd))} left of your ${formatUsd(limit)} limit.`}
        </Text>
        <Text variant="muted" style={styles.small} testID="ai-limit-counts">
          The dollar limit counts Claude models, the only ones Tide knows prices for. Other models (OpenAI, Gemini, OpenRouter, your own server) count toward the token
          limit below instead.
          {totals.unknownPrice
            ? ` They used ${formatTokens(totals.unpricedTokens)} tokens this month${tokenLimit === null ? ', with no token limit.' : ` of ${formatTokens(tokenLimit)}.`}`
            : ''}
        </Text>
        <Text variant="label">Monthly limit</Text>
        <View style={styles.chips}>
          {LIMITS.map((l) => (
            <Pressable
              key={String(l)}
              onPress={() => (haptic('select'), aiSettings.getState().setMonthlyLimit(l))}
              accessibilityRole="radio"
              accessibilityState={{ selected: limit === l }}
              style={[styles.chip, limit === l && styles.chipOn]}
              testID={`ai-limit-${l ?? 'none'}`}
            >
              <Text variant="label">{l === null ? 'None' : `$${l}`}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.otherRow}>
          <TextInput
            value={other}
            onChangeText={setOther}
            placeholder={limit !== null && !LIMITS.includes(limit) ? `$${limit}` : 'Other amount'}
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            style={[styles.input, styles.flex]}
            testID="ai-limit-other"
          />
          <Button
            title="Set"
            variant="outline"
            disabled={!(Number(other.replace(/[$,\s]/g, '')) > 0)}
            onPress={() => {
              aiSettings.getState().setMonthlyLimit(Number(other.replace(/[$,\s]/g, '')));
              setOther('');
              haptic('success');
            }}
            testID="ai-limit-set"
          />
        </View>
        <Text variant="label">Token limit for models without a price</Text>
        <View style={styles.chips}>
          {TOKEN_LIMITS.map((l) => (
            <Pressable
              key={String(l)}
              onPress={() => (haptic('select'), aiSettings.getState().setUnpricedTokenLimit(l))}
              accessibilityRole="radio"
              accessibilityState={{ selected: tokenLimit === l }}
              style={[styles.chip, tokenLimit === l && styles.chipOn]}
              testID={`ai-token-limit-${l ?? 'none'}`}
            >
              <Text variant="label">{l === null ? 'None' : formatTokens(l)}</Text>
            </Pressable>
          ))}
        </View>
        {current.length > 0 && (
          <View style={styles.breakdown}>
            {current.map((e) => (
              <View key={`${e.provider}:${e.model}`} style={styles.breakdownRow}>
                <Text variant="muted" numberOfLines={1} style={styles.flex}>
                  {modelLabel(e.model)} · {PROVIDERS[e.provider].name}
                </Text>
                <Text variant="mono" style={styles.small}>
                  {formatTokens(e.inputTokens + e.outputTokens)} · {e.costUsd === null ? 'price unknown' : formatUsd(e.costUsd)}
                </Text>
              </View>
            ))}
          </View>
        )}
        <Text variant="muted" style={styles.small}>
          Estimated on this device from the tokens each answer used, including answers that were stopped or failed partway. Your provider’s console has the actual bill.
        </Text>
      </View>
    </Section>
  );
}

// Models from the connected providers for one job, and "Custom model…".
function ModelPicker({ job, onClose, onAddProvider }: { job: AiJob | null; onClose(): void; onAddProvider(p: ProviderId): void }) {
  const styles = useStyles();
  const colors = useColors();
  const connected = useAiSettings((s) => s.connected);
  const known = useAiSettings((s) => s.knownModels);
  const current = useAiSettings((s) => (job ? s.jobs[job] : null));
  const [filter, setFilter] = useState('');
  const [custom, setCustom] = useState<{ provider: ProviderId; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providers = PROVIDER_ORDER.filter((p) => connected[p]);

  const close = () => {
    setFilter('');
    setCustom(null);
    setError(null);
    onClose();
  };
  const pick = (ref: ModelRef) => {
    if (!job) return;
    if (ref.provider !== 'anthropic' && isClaudeModel(ref.model)) {
      setError('Claude models go through the Anthropic provider. Add an Anthropic key and pick the model there.');
      return;
    }
    if (!ref.model.trim()) return;
    aiSettings.getState().setJob(job, ref);
    haptic('select');
    close();
  };

  const optionsFor = (p: ProviderId) => {
    const info = PROVIDERS[p];
    const suggested = [...info.models[job ?? 'chat'], ...JOBS.flatMap((j) => info.models[j])];
    const all = [...new Set([...suggested, ...(known[p] ?? [])])].filter((m) => p === 'anthropic' || !isClaudeModel(m));
    const q = filter.trim().toLowerCase();
    return (q ? all.filter((m) => m.toLowerCase().includes(q)) : all).slice(0, q ? 60 : 12);
  };
  const many = providers.some((p) => (known[p]?.length ?? 0) > 12);

  return (
    <Sheet visible={job !== null} onClose={close} scrollable>
      <Text variant="title">{job ? JOB_LABELS[job] : ''}</Text>
      {providers.length === 0 ? (
        <>
          <Text variant="muted">Connect a provider first.</Text>
          <Button title="Add an Anthropic key" onPress={() => onAddProvider('anthropic')} />
        </>
      ) : (
        <>
          {many && (
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Filter models"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              testID="ai-model-filter"
            />
          )}
          {providers.map((p) => (
            <View key={p} style={styles.group}>
              <View style={styles.groupHead}>
                <ProviderBadge provider={p} size={20} />
                <Text variant="label">{PROVIDERS[p].name}</Text>
              </View>
              {optionsFor(p).map((m) => {
                const on = current?.provider === p && current.model === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => pick({ provider: p, model: m })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.option, on && styles.optionOn]}
                    testID={`ai-model-${p}-${m}`}
                  >
                    <Text variant="label" style={styles.flex} numberOfLines={1}>
                      {modelLabel(m)}
                    </Text>
                    {on && <Icon name="check" size={16} color={colors.brand} />}
                  </Pressable>
                );
              })}
              {optionsFor(p).length === 0 && <Text variant="muted">No models listed. Use Custom model below.</Text>}
            </View>
          ))}
          {custom ? (
            <View style={styles.group}>
              <Text variant="label">Custom model</Text>
              {providers.length > 1 && (
                <Segmented<ProviderId> value={custom.provider} onChange={(provider) => setCustom({ ...custom, provider })} options={providers.map((p) => ({ value: p, label: PROVIDERS[p].letter === '~' ? 'Own' : PROVIDERS[p].name.split(' ').pop()! }))} />
              )}
              <TextInput
                value={custom.model}
                onChangeText={(model) => setCustom({ ...custom, model })}
                placeholder={custom.provider === 'custom' ? 'e.g. qwen2.5-coder:7b' : 'The model’s exact name'}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                style={styles.input}
                testID="ai-model-custom-input"
              />
              <Button title="Use this model" onPress={() => pick(custom)} disabled={!custom.model.trim()} testID="ai-model-custom-save" />
            </View>
          ) : (
            <Pressable onPress={() => setCustom({ provider: current && connected[current.provider] ? current.provider : providers[0], model: '' })} accessibilityRole="button" style={styles.option} testID="ai-model-custom">
              <Text variant="label" style={[styles.flex, { color: colors.brand }]}>
                Custom model…
              </Text>
            </Pressable>
          )}
          {error && <Text variant="error">{error}</Text>}
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  intro: { paddingHorizontal: spacing.xs, marginBottom: spacing.sm },
  section: { gap: spacing.sm, marginBottom: spacing.md },
  sectionTitle: { paddingHorizontal: spacing.xs, fontSize: fontSizes.xs, letterSpacing: 0.6 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth, borderColor: colors.border, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
    marginBottom: -borderWidth,
  },
  pressed: { backgroundColor: colors.secondary },
  rowText: { flex: 1, gap: 1 },
  detail: { fontSize: fontSizes.sm },
  flex: { flex: 1 },
  small: { fontSize: fontSizes.xs },
  month: { padding: spacing.md, gap: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: { flex: 1, gap: 2 },
  big: { color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: fontSizes.xxl },
  bar: { height: 8, borderRadius: radius.pill, backgroundColor: colors.secondary, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill, backgroundColor: '#2dd4bf', experimental_backgroundImage: 'linear-gradient(90deg, #0ea5e9, #2dd4bf)' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
  },
  breakdown: { gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: borderWidth, borderColor: colors.border },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  group: { gap: spacing.xs },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
}));
