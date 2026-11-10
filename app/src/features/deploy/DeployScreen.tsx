import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { ActivityIndicator, Alert, Linking, Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { parseRemote, timeAgo } from '../github/api';
import { deployConfirmation } from '../launch/links';
import type { DeployRecord, DeployStatus } from './auto';
import { deployStore } from './index';
import { currentBranch, deploy, getToken, guessFolder, PREVIEWS, PROVIDERS, readConfig, saveConfig, setToken } from './deploy';
import { DeployConfig, ProviderId } from './providers';

// One shared empty list: a new [] on every render would re-render forever.
const NO_HISTORY: DeployRecord[] = [];

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
  // go=1 comes from the Deploy Project action in Shortcuts: deploy on opening, once confirmed.
  const { project, go } = useLocalSearchParams<{ project: string; go?: string }>();
  const styles = useStyles();
  const colors = useColors();
  const [config, setConfig] = useState<DeployConfig | null>(null);
  const [token, setTokenValue] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [wasPreview, setWasPreview] = useState(false);
  const [branch, setBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const history = useStore(deployStore, (s) => s.history[project] ?? NO_HISTORY);

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

  useEffect(() => {
    currentBranch(project).then(setBranch);
  }, [project]);

  const runRef = useRef<((preview?: boolean) => Promise<void>) | null>(null);
  const autoRan = useRef(false);
  useEffect(() => {
    if (go !== '1' || !config || autoRan.current) return;
    autoRan.current = true;
    // Any app or page can open the link, so it asks first.
    const ask = deployConfirmation(project);
    Alert.alert(ask.title, ask.message, [
      { text: 'Cancel', style: 'cancel' },
      { text: ask.action, onPress: () => runRef.current?.() },
    ]);
  }, [go, config, project]);

  if (!config) return <Screen title="Deploy" subtitle={project}><ActivityIndicator color={colors.mutedForeground} /></Screen>;
  const provider = PROVIDERS.find((p) => p.id === config.provider)!;
  const update = (patch: Partial<DeployConfig>) => setConfig({ ...config, ...patch });

  // `preview` deploys to a preview URL for the current branch, leaving the live site alone.
  const run = async (preview = false) => {
    setBusy(true);
    setError(null);
    setUrl(null);
    setWasPreview(preview);
    // Shared, for the project screen's status bar and the Live Activity.
    const report = (s: Omit<DeployStatus, 'provider'>) => deployStore.getState().setStatus(project, { ...s, provider: config.provider });
    const progress = (message: string) => {
      setStatus(message);
      report({ state: 'deploying', message });
    };
    try {
      if (token.trim()) await setToken(config.provider, project, token);
      progress('Deploying…');
      const result = await deploy(project, config, progress, preview ? (branch ?? 'preview') : undefined);
      report({ state: 'done', message: preview ? 'Preview published' : 'Deployed', url: result.url });
      const next = { ...config, ...result.config };
      await saveConfig(project, next);
      setConfig(next);
      setUrl(result.url);
      deployStore.getState().record(project, { at: Date.now(), provider: config.provider, trigger: 'manual', ok: true, url: result.url, ...(preview ? { preview: true } : {}) });
      setHasToken(true);
      setTokenValue('');
      haptic('success');
    } catch (e) {
      haptic('error');
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      report({ state: 'failed', message });
      deployStore.getState().record(project, { at: Date.now(), provider: config.provider, trigger: 'manual', ok: false, error: message, ...(preview ? { preview: true } : {}) });
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  runRef.current = run;

  const setAuto = async (auto: 'off' | 'save' | 'commit') => {
    const next = { ...config, auto };
    setConfig(next);
    await saveConfig(project, next);
    haptic('select');
  };

  const field = (label: string, value: string, onChange: (v: string) => void, placeholder?: string, hint?: string, secure = false, multiline = false) => (
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
        // Deploy tokens and keys aren't logins: keep iOS from offering to save them to Passwords.
        textContentType={secure ? 'none' : undefined}
        autoComplete={secure ? 'off' : undefined}
        multiline={multiline}
        selectionColor={colors.brand}
        style={[styles.input, multiline && styles.multiline]}
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
      {config.provider === 'firebase' &&
        field('Hosting site', config.firebase?.site ?? '', (site) => update({ firebase: { site } }), 'Empty uses the project ID', 'Your site is at <site>.web.app.')}
      {provider.token &&
        (config.provider === 'firebase'
          ? // A key file is several lines, and iOS can't hide multi-line text, so a saved key is never shown back.
            field(provider.token, token, setTokenValue, hasToken ? 'Saved in the Keychain. Paste a new key to replace it.' : '{ "type": "service_account", … }', 'Kept in the Keychain. Only a short-lived sign-in token is sent to Google.', false, true)
          : field(provider.token, token, setTokenValue, hasToken ? 'Saved in the Keychain. Type to replace it.' : 'Paste it here', 'Kept in the Keychain and only sent to the service.', true))}
      {config.provider === 'render' &&
        field('Deploy Hook URL', token, setTokenValue, hasToken ? 'Saved in the Keychain. Type to replace it.' : 'https://api.render.com/deploy/srv-…', 'Settings → Deploy Hook in your Render service. Kept in the Keychain.', true)}
      {config.provider === 'github' && !hasToken && <Text variant="error">Sign in to GitHub first, in Settings → GitHub.</Text>}

      <View style={styles.field}>
        <Text variant="label">Deploy automatically</Text>
        <View style={styles.providers}>
          {(
            [
              ['off', 'Off'],
              ['save', 'When I save'],
              ['commit', 'After each commit'],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setAuto(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: (config.auto ?? 'off') === value }}
              style={[styles.chip, (config.auto ?? 'off') === value && styles.chipOn]}
              testID={`deploy-auto-${value}`}
            >
              <Text variant="label">{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text variant="muted">
          {config.auto === 'save'
            ? 'Deploys 15 seconds after you stop saving, while the project is open.'
            : config.auto === 'commit'
              ? 'Deploys after each commit from Source Control or git commit in the terminal.'
              : 'Deploy with the button below.'}
        </Text>
      </View>

      <Button title={busy ? 'Deploying…' : 'Deploy'} icon="upload-cloud" onPress={() => run()} disabled={busy} testID="deploy-run" />
      {PREVIEWS.includes(config.provider) && (
        <View style={styles.field}>
          <Button title={`Deploy a preview${branch ? ` of ${branch}` : ''}`} variant="outline" icon="eye" onPress={() => run(true)} disabled={busy} testID="deploy-preview" />
          <Text variant="muted">Publishes to its own link to check or share, without changing your live site.</Text>
        </View>
      )}
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
          <Text variant="label">{config.provider === 'render' ? 'Render is building your site' : wasPreview ? 'Preview published' : 'Published'}</Text>
          <Text variant="mono" selectable>
            {url}
          </Text>
          {config.provider === 'github' && <Text variant="muted">GitHub Pages can take a minute to update.</Text>}
          {wasPreview && <Text variant="muted">Your live site didn't change.{config.provider === 'firebase' ? ' Firebase deletes the preview after 7 days.' : ''}</Text>}
          <View style={styles.row}>
            {wasPreview ? (
              <Button title="Preview" icon="eye" onPress={() => router.push({ pathname: '/preview', params: { url, port: '', project } })} testID="deploy-open-preview" />
            ) : (
              <Button title="Open" icon="external-link" onPress={() => Linking.openURL(url)} />
            )}
            <Button title="Copy link" variant="outline" icon="copy" onPress={() => Clipboard.setStringAsync(url).then(() => haptic('success'))} />
          </View>
        </View>
      )}
      {history.length > 0 && (
        <View style={styles.field}>
          <Text variant="label">Recent deploys</Text>
          {history.map((h) => (
            <Pressable
              key={h.at}
              onPress={() => h.url && Linking.openURL(h.url)}
              disabled={!h.url}
              accessibilityRole={h.url ? 'link' : undefined}
              style={styles.historyRow}
            >
              <Text style={{ color: h.ok ? colors.success : colors.destructive }}>{h.ok ? '✓' : '✕'}</Text>
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>
                  {PROVIDERS.find((p) => p.id === h.provider)?.label ?? h.provider}
                  {h.preview ? ' preview' : ''} · {h.trigger === 'manual' ? 'by hand' : h.trigger === 'save' ? 'after saving' : 'after a commit'}
                </Text>
                <Text variant="muted" numberOfLines={2}>
                  {timeAgo(new Date(h.at).toISOString())}
                  {h.ok ? (h.url ? ` · ${h.url}` : '') : ` · ${h.error}`}
                </Text>
              </View>
            </Pressable>
          ))}
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
  multiline: { minHeight: 120, maxHeight: 200, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  historyRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingVertical: spacing.xs },
  done: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth, borderColor: colors.success, backgroundColor: colors.successSoft },
}));
