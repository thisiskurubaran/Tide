import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { normalizeUrl, remoteSettingsStore, useRemoteSettings, validateSettings } from './settings';
import { makeStyles, useColors } from '../../theme/theme';

export function RemoteSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const saved = useRemoteSettings((s) => s.settings);
  const [url, setUrl] = useState(saved?.url ?? '');
  const [token, setToken] = useState(saved?.token ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const settings = { url: normalizeUrl(url), token: token.trim() };
    const problem = validateSettings(settings);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await remoteSettingsStore.getState().save(settings);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    await remoteSettingsStore.getState().clear();
    setUrl('');
    setToken('');
  }

  const input = {
    autoCapitalize: 'none',
    autoCorrect: false,
    autoComplete: 'off',
    spellCheck: false,
    placeholderTextColor: colors.mutedForeground,
    selectionColor: colors.brand,
    style: styles.input,
  } as const;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <Text variant="title">Remote server</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]} keyboardShouldPersistTaps="handled">
        <Text variant="muted">
          Remote mode runs each project in a container on a Tide server you host. Both values are stored in the Keychain on this device.
        </Text>
        <View style={styles.field}>
          <Text variant="label">Server URL</Text>
          <TextInput
            {...input}
            testID="remote-url"
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setError(null);
            }}
            placeholder="http://192.168.1.20:8787"
            keyboardType="url"
            textContentType="URL"
          />
        </View>
        <View style={styles.field}>
          <Text variant="label">Token</Text>
          <TextInput
            {...input}
            testID="remote-token"
            value={token}
            onChangeText={(v) => {
              setToken(v);
              setError(null);
            }}
            placeholder="TIDE_TOKEN from the server"
            secureTextEntry
            textContentType="password"
          />
        </View>
        {error && <Text variant="error">{error}</Text>}
        <View style={styles.actions}>
          {saved && <Button title="Forget" variant="outline" onPress={forget} testID="remote-forget" />}
          <Button title="Save" onPress={save} disabled={busy} testID="remote-save" />
        </View>
      </ScrollView>
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
  content: { padding: spacing.md, gap: spacing.md },
  field: { gap: spacing.xs },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.md,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
