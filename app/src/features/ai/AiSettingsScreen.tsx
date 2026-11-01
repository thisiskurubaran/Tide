import { useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { createClient, describeError, MODELS } from './assistant';
import { aiSettings, getApiKey, setApiKey, useAiSettings } from './settings';

// The Anthropic API key and model for the AI assistant (Tide Pro).
export function AiSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const hasKey = useAiSettings((s) => s.hasKey);
  const model = useAiSettings((s) => s.model);
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const candidate = key.trim() || (await getApiKey()) || '';
      if (!candidate) throw new Error('Paste an API key first.');
      // A tiny request, to check the key before keeping it.
      await createClient(candidate).models.retrieve(model);
      if (key.trim()) await setApiKey(key);
      setKey('');
      haptic('success');
      setStatus({ ok: true, text: 'The key works.' });
    } catch (e) {
      haptic('error');
      setStatus({ ok: false, text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="AI assistant" subtitle="Tide Pro" testID="ai-settings">
      <Text variant="muted">
        Ask Claude to explain, fix or change the file you're working on, from the command palette. It uses your own Anthropic API key, so requests go straight from this
        device to Anthropic and are billed to your Anthropic account. The file you ask about is sent with each request.
      </Text>
      <View style={styles.field}>
        <Text variant="label">Anthropic API key</Text>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder={hasKey ? 'Saved in the Keychain. Paste a new one to replace it.' : 'sk-ant-…'}
          placeholderTextColor={colors.mutedForeground}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID="ai-key"
        />
        <Pressable onPress={() => Linking.openURL('https://console.anthropic.com/settings/keys')} accessibilityRole="link">
          <Text variant="muted" style={{ color: colors.brand }}>
            Create a key in the Anthropic Console
          </Text>
        </Pressable>
      </View>
      <View style={styles.field}>
        <Text variant="label">Model</Text>
        {MODELS.map((m) => (
          <Pressable
            key={m.id}
            onPress={() => aiSettings.getState().setModel(m.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected: model === m.id }}
            style={[styles.option, model === m.id && styles.optionOn]}
            testID={`ai-model-${m.id}`}
          >
            <Text variant="label">{m.label}</Text>
            <Text variant="muted">{m.detail}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Button title={busy ? 'Checking…' : key.trim() ? 'Save and check' : 'Check the key'} onPress={save} disabled={busy || (!key.trim() && !hasKey)} testID="ai-save" />
        {hasKey && (
          <Button
            title="Remove key"
            variant="outline"
            icon="trash-2"
            onPress={async () => {
              await setApiKey('');
              setStatus(null);
            }}
          />
        )}
      </View>
      {status && <Text variant={status.ok ? 'muted' : 'error'}>{status.text}</Text>}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  field: { gap: spacing.xs },
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
  option: { gap: 2, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border },
  optionOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
}));
