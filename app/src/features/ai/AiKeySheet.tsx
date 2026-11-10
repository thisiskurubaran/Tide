import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { Linking, Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { PROVIDERS } from './providers/catalog';
import { describeError } from './providers/errors';
import type { ProviderId } from './providers/types';
import { baseUrlFor, getKey, useAiSettings } from './settings';
import { connectProvider, disconnectProvider } from './setup';

// The provider's letter on its color (a neutral one for your own server).
export function ProviderBadge({ provider, size = 28 }: { provider: ProviderId; size?: number }) {
  const colors = useColors();
  const info = PROVIDERS[provider];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: info.color ?? colors.secondary,
        borderWidth: info.color ? 0 : borderWidth,
        borderColor: colors.border,
      }}
    >
      {/* A fixed-size mark: the letter doesn't scale with Dynamic Type, but never drops below 11pt. */}
      <Text allowFontScaling={false} style={{ color: info.color ? '#ffffff' : colors.foreground, fontFamily: fonts.heading.semibold, fontSize: Math.max(fontSizes.xs, size * 0.5) }}>
        {info.letter}
      </Text>
    </View>
  );
}

interface KeyFormProps {
  provider: ProviderId;
  // Called after the key was tested and saved.
  onSaved(models: string[]): void;
  // A second button next to "Save and test" ("Not now" in the setup sheet).
  secondary?: { title: string; onPress(): void };
  testID?: string;
}

// Paste a key (and, for your own server, its address), then Save and test.
export function KeyForm({ provider, onSaved, secondary, testID = 'ai-key' }: KeyFormProps) {
  const styles = useStyles();
  const colors = useColors();
  const info = PROVIDERS[provider];
  const connected = useAiSettings((s) => !!s.connected[provider]);
  const savedUrl = useAiSettings((s) => s.baseUrls[provider] ?? '');
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(savedUrl);
  const [showUrl, setShowUrl] = useState(provider === 'custom' || !!savedUrl);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setKey('');
    setUrl(savedUrl);
    setShowUrl(provider === 'custom' || !!savedUrl);
    setStatus(null);
    // Only when switching provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // With nothing pasted, the saved key is tested again.
      const candidate = key.trim() || (connected ? ((await getKey(provider)) ?? '') : '');
      const models = await connectProvider(provider, candidate, showUrl ? url : '');
      setKey('');
      haptic('success');
      setStatus({ ok: true, text: provider === 'custom' ? `Connected. ${models.length ? `${models.length} models available.` : 'The server listed no models; type one in when picking.'}` : 'The key works.' });
      onSaved(models);
    } catch (e) {
      haptic('error');
      setStatus({ ok: false, text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (text) setKey(text);
  };

  const needsKey = info.keyRequired && !key.trim() && !connected;
  return (
    <View style={styles.form}>
      {showUrl && (
        <View style={styles.field}>
          <Text variant="label">{provider === 'custom' ? 'Server address' : 'Address'}</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder={provider === 'custom' ? 'http://192.168.1.20:11434/v1' : info.baseUrl}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
            testID={`${testID}-url`}
          />
        </View>
      )}
      <View style={styles.field}>
        <Text variant="label">{info.keyRequired ? 'API key' : 'API key (optional)'}</Text>
        <View style={styles.keyRow}>
          <TextInput
            value={key}
            onChangeText={setKey}
            placeholder={connected ? 'Saved in the Keychain. Paste a new one to replace it.' : info.keyPlaceholder}
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            // An API key, not a password: "none" + autoComplete off keeps iOS from
            // offering to save it to Passwords or suggesting one-time codes.
            textContentType="none"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={[styles.input, styles.flex]}
            testID={testID}
          />
          <Button title="Paste" variant="outline" icon="clipboard" onPress={paste} testID={`${testID}-paste`} />
        </View>
        <Text variant="muted">{info.keyHelp}</Text>
        {info.keyUrl && (
          <Pressable onPress={() => Linking.openURL(info.keyUrl!)} accessibilityRole="link">
            <Text variant="muted" style={{ color: colors.brand }}>
              {/^[AEIOU]/i.test(info.name) ? 'Get an' : 'Get a'} {info.name} key
            </Text>
          </Pressable>
        )}
        {provider !== 'custom' && !showUrl && (
          <Pressable onPress={() => setShowUrl(true)} accessibilityRole="button" testID={`${testID}-show-url`}>
            <Text variant="muted" style={{ color: colors.brand }}>
              Use a different address
            </Text>
          </Pressable>
        )}
      </View>
      <View style={styles.row}>
        <Button title={busy ? 'Testing…' : 'Save and test'} onPress={save} disabled={busy || needsKey || (provider === 'custom' && !url.trim())} testID={`${testID}-save`} />
        {secondary && <Button title={secondary.title} variant="outline" onPress={secondary.onPress} testID={`${testID}-secondary`} />}
      </View>
      {status && (
        <Text variant={status.ok ? 'muted' : 'error'} selectable testID={`${testID}-status`}>
          {status.ok ? '✓ ' : ''}
          {status.text}
        </Text>
      )}
    </View>
  );
}

// One provider's key, from the settings screen: paste, Save and test, Remove.
export function AiKeySheet({ provider, onClose }: { provider: ProviderId | null; onClose(): void }) {
  const styles = useStyles();
  const connected = useAiSettings((s) => (provider ? !!s.connected[provider] : false));
  const info = provider ? PROVIDERS[provider] : null;
  return (
    <Sheet visible={provider !== null} onClose={onClose} scrollable>
      {provider && info && (
        <>
          <View style={styles.header}>
            <ProviderBadge provider={provider} />
            <View style={styles.flex}>
              <Text variant="title">{info.name}</Text>
              <Text variant="muted" numberOfLines={1}>
                {connected ? `Connected · ${baseUrlFor(provider) || 'api.anthropic.com'}` : info.blurb}
              </Text>
            </View>
          </View>
          <KeyForm provider={provider} onSaved={() => undefined} testID="ai-key" />
          {connected && (
            <Button
              title={provider === 'custom' ? 'Remove server' : 'Remove key'}
              variant="outline"
              icon="trash-2"
              onPress={async () => {
                await disconnectProvider(provider);
                haptic('success');
                onClose();
              }}
              testID="ai-key-remove"
            />
          )}
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  form: { gap: spacing.md },
  field: { gap: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
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
}));
