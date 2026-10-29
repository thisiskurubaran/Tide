import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { gitSettingsStore, useGitSettings } from './settings';

export function GitSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const saved = useGitSettings((s) => s.settings);
  const [name, setName] = useState(saved.name);
  const [email, setEmail] = useState(saved.email);
  const [token, setToken] = useState(saved.token);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (email.trim() && !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
      setError('The email address is not valid');
      return;
    }
    try {
      await gitSettingsStore.getState().save({ name: name.trim(), email: email.trim(), token: token.trim() });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
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
        <Text variant="title">Git</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]} keyboardShouldPersistTaps="handled">
        <Text variant="muted">
          Used by git in the Local terminal and by Source Control. Commits need a name and email. Pushing, and cloning private
          repositories, need a personal access token (for GitHub, a fine-grained token with Contents read and write). All three
          are kept in the Keychain.
        </Text>
        <View style={styles.field}>
          <Text variant="label">Name</Text>
          <TextInput {...input} testID="git-name" value={name} onChangeText={setName} placeholder="Ada Lovelace" autoCapitalize="words" />
        </View>
        <View style={styles.field}>
          <Text variant="label">Email</Text>
          <TextInput
            {...input}
            testID="git-email"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder="ada@example.com"
            keyboardType="email-address"
          />
        </View>
        <View style={styles.field}>
          <Text variant="label">Access token</Text>
          <TextInput
            {...input}
            testID="git-token"
            value={token}
            onChangeText={setToken}
            placeholder="github_pat_..."
            secureTextEntry
            // Without this iOS treats the field as a password and offers to save the token to Passwords.
            textContentType="oneTimeCode"
          />
        </View>
        {error && <Text variant="error">{error}</Text>}
        <View style={styles.actions}>
          <Button title="Save" onPress={save} testID="git-save" />
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
