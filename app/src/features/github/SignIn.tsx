import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { accountStore } from './account';
import { DeviceCode, GITHUB_CLIENT_ID, startDeviceFlow, waitForToken } from './auth';

// Sign in with a code on github.com, or paste a personal access token.
export function SignIn({ onDone }: { onDone?: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useToken, setUseToken] = useState(!GITHUB_CLIENT_ID);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const start = async () => {
    setError(null);
    setBusy(true);
    cancelled.current = false;
    try {
      const c = await startDeviceFlow();
      setCode(c);
      await Clipboard.setStringAsync(c.user_code);
      Linking.openURL(c.verification_uri).catch(() => undefined);
      const t = await waitForToken(c, () => cancelled.current);
      if (!t) return;
      await accountStore.getState().signIn(t);
      haptic('success');
      onDone?.();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
      setCode(null);
    } finally {
      setBusy(false);
    }
  };

  const saveToken = async () => {
    setError(null);
    setBusy(true);
    try {
      await accountStore.getState().signIn(token.trim());
      haptic('success');
      onDone?.();
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box} testID="github-sign-in">
      <Text variant="heading" style={styles.center}>
        GitHub
      </Text>
      <Text variant="muted" style={styles.center}>
        Browse and clone your repositories, review pull requests, work on issues and follow Actions. Your token stays in the Keychain and is
        only sent to GitHub.
      </Text>
      {code ? (
        <View style={styles.code}>
          <Text variant="muted">Enter this code on GitHub (it's copied):</Text>
          <Text selectable style={styles.userCode} testID="github-user-code">
            {code.user_code}
          </Text>
          <View style={styles.row}>
            <ActivityIndicator color={colors.mutedForeground} />
            <Text variant="muted">Waiting for GitHub…</Text>
          </View>
          <Button title="Open GitHub again" variant="outline" icon="external-link" onPress={() => Linking.openURL(code.verification_uri)} />
          <Button
            title="Cancel"
            variant="outline"
            onPress={() => {
              cancelled.current = true;
              setCode(null);
            }}
          />
        </View>
      ) : useToken ? (
        <View style={styles.form}>
          <Text variant="label">Personal access token</Text>
          <TextInput
            testID="github-token"
            value={token}
            onChangeText={setToken}
            placeholder="github_pat_… or ghp_…"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            // A token, not a login: keeps iOS from offering to save it to Passwords.
            textContentType="none"
            autoComplete="off"
            selectionColor={colors.brand}
            style={styles.input}
          />
          <Text variant="muted">Create one at github.com → Settings → Developer settings. Give it access to the repositories you want, with Contents, Pull requests, Issues and Actions.</Text>
          <Button title={busy ? 'Checking…' : 'Sign in'} onPress={saveToken} disabled={busy || !token.trim()} testID="github-token-save" />
          {GITHUB_CLIENT_ID ? <Button title="Sign in with GitHub instead" variant="outline" onPress={() => setUseToken(false)} /> : null}
        </View>
      ) : (
        <View style={styles.form}>
          <Button title={busy ? 'Starting…' : 'Sign in with GitHub'} icon="github" onPress={start} disabled={busy} testID="github-sign-in-button" />
          <Button title="Use a token instead" variant="outline" onPress={() => setUseToken(true)} testID="github-use-token" />
        </View>
      )}
      {error && (
        <Text variant="error" style={styles.center} selectable>
          {error}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  box: { gap: spacing.md, padding: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  center: { textAlign: 'center' },
  form: { gap: spacing.sm },
  code: { gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  userCode: { fontFamily: fonts.mono.semibold, fontSize: 34, letterSpacing: 4, color: colors.foreground },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
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
