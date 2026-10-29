import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { parseRemote } from '../github/api';
import { deploy, getToken, guessFolder, PROVIDERS, readConfig, saveConfig, setToken } from './deploy';
import { DeployConfig, ProviderId } from './providers';

// The GitHub repository a clone came from, from .git/config.
async function githubRemote(project: string) {
  try {
    const config = await workspace.readFile(project, '.git/config');
    const url = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config)?.[1];
    return url ? parseRemote(url) : null;
  } catch {
    return null;
  }
}

// Publish a folder of the project to GitHub Pages, Netlify, Vercel, Cloudflare
// Pages, or trigger a Render deploy. Free for everyone.
export function DeployScreen() {
  const { project } = useLocalSearchParams<{ project: string }>();
  const styles = useStyles();
  const colors = useColors();
  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [token, setTokenValue] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await readConfig(project);
      const remote = await githubRemote(project);
      setConfig(
        saved ?? {
          provider: 'github',
          folder: await guessFolder(project),
          github: { owner: remote?.owner ?? '', repo: remote?.repo ?? '', branch: 'gh-pages' },
        },
      );
    })();
  }, [project]);

  useEffect(() => {
    if (!config) return;
    setTokenValue('');
    getToken(config.provider, project).then((t) => setHasToken(!!t));
  }, [config?.provider, project]);

  if (!config) return <Screen title="Deploy" subtitle={project}><ActivityIndicator color={colors.mutedForeground} /></Screen>;
  const provider = PROVIDERS.find((p) => p.id === config.provider)!;
  const update = (patch: Partial<DeployConfig>) => setConfig({ ...config, ...patch });

  const run = async () => {
    setBusy(true);
    setError(null);
    setUrl(null);
    try {
      if (token.trim()) await setToken(config.provider, project, token);
      const result = await deploy(project, config, setStatus);
      const next = { ...config, ...result.config };
      await saveConfig(project, next);
      setConfig(next);
      setUrl(result.url);
      setHasToken(true);
      setTokenValue('');
      haptic('success');
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string, hint?: string, secure = false) => (
    <View style={styles.field} key={label}>
      <Text variant="label">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={secure}
        selectionColor={colors.brand}
        style={styles.input}
        testID={`deploy-${label.toLowerCase().replace(/\W+/g, '-')}`}
      />
      {hint ? <Text variant="muted">{hint}</Text> : null}
    </View>
  );

  return (
    <Screen title="Deploy" subtitle={project} testID="deploy">
      <View style={styles.providers}>
        {PROVIDERS.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => update({ provider: p.id as ProviderId })}
            accessibilityRole="radio"
            accessibilityState={{ selected: config.provider === p.id }}
            style={[styles.chip, config.provider === p.id && styles.chipOn]}
            testID={`deploy-provider-${p.id}`}
          >
            <Text variant="label">{p.label}</Text>
          </Pressable>
        ))}
      </View>
      <Text variant="muted">{provider.help}</Text>

      {config.provider !== 'render' &&
        field('Folder to publish', config.folder, (folder) => update({ folder }), 'dist', config.folder ? `Publishes ${config.folder}/ with its index.html.` : 'Publishes the whole project. It needs an index.html.')}
      {config.provider === 'github' && (
        <>
          {field('Repository owner', config.github?.owner ?? '', (owner) => update({ github: { ...config.github!, owner } }), 'your-username')}
          {field('Repository', config.github?.repo ?? '', (repo) => update({ github: { ...config.github!, repo } }), 'my-site')}
          {field('Branch', config.github?.branch ?? 'gh-pages', (branch) => update({ github: { ...config.github!, branch } }), 'gh-pages', 'Replaced with the folder on each deploy. Use a branch just for the site.')}
        </>
      )}
      {config.provider === 'netlify' && field('Site ID', config.netlify?.siteId ?? '', (siteId) => update({ netlify: { siteId } }), 'Empty creates a new site', 'Filled in after the first deploy.')}
      {config.provider === 'vercel' && field('Project name', config.vercel?.project ?? '', (p) => update({ vercel: { project: p } }), project.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
      {config.provider === 'cloudflare' && (
        <>
          {field('Account ID', config.cloudflare?.accountId ?? '', (accountId) => update({ cloudflare: { project: config.cloudflare?.project ?? '', accountId } }), '32-character ID', 'On the right of your Cloudflare dashboard’s overview.')}
          {field('Project name', config.cloudflare?.project ?? '', (p) => update({ cloudflare: { accountId: config.cloudflare?.accountId ?? '', project: p } }), 'my-site', 'Created on the first deploy if it doesn’t exist.')}
        </>
      )}
      {provider.token &&
        field(provider.token, token, setTokenValue, hasToken ? 'Saved in the Keychain. Type to replace it.' : 'Paste it here', 'Kept in the Keychain and only sent to the service.', true)}
      {config.provider === 'render' &&
        field('Deploy Hook URL', token, setTokenValue, hasToken ? 'Saved in the Keychain. Type to replace it.' : 'https://api.render.com/deploy/srv-…', 'Settings → Deploy Hook in your Render service. Kept in the Keychain.', true)}
      {config.provider === 'github' && !hasToken && <Text variant="error">Sign in to GitHub first, in Settings → GitHub.</Text>}

      <Button title={busy ? 'Deploying…' : 'Deploy'} icon="upload-cloud" onPress={run} disabled={busy} testID="deploy-run" />
      {status && (
        <View style={styles.row}>
          <ActivityIndicator color={colors.mutedForeground} />
          <Text variant="muted">{status}</Text>
        </View>
      )}
      {error && (
        <Text variant="error" selectable>
          {error}
        </Text>
      )}
      {url && (
        <View style={styles.done} testID="deploy-done">
          <Text variant="label">{config.provider === 'render' ? 'Render is building your site' : 'Published'}</Text>
          <Text variant="mono" selectable>
            {url}
          </Text>
          {config.provider === 'github' && <Text variant="muted">GitHub Pages can take a minute to update.</Text>}
          <View style={styles.row}>
            <Button title="Open" icon="external-link" onPress={() => Linking.openURL(url)} />
            <Button title="Copy link" variant="outline" icon="copy" onPress={() => Clipboard.setStringAsync(url).then(() => haptic('success'))} />
          </View>
        </View>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  field: { gap: spacing.xs },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  done: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth, borderColor: colors.success, backgroundColor: colors.successSoft },
}));
