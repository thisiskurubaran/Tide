import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import type { KeymapSetting } from '../editor/bridge';
import { accountStore, useAccount } from '../github/account';
import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { ContrastSetting, EditorOptionKey, FONT_SIZE_MAX, FONT_SIZE_MIN, ThemeSetting } from '../../state/settings';
import { makeStyles, useChromeTheme, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing, fontSizes } from '../../theme/tokens';
import { useExtensions } from '../../extensions/state';
import { isActive } from '../../extensions/store';
import { useGitSettings } from '../git/settings';
import { crashReportsAvailable } from '../privacy/crashReports';
import { useRemoteSettings } from '../remote/settings';
import { appVersion, contactSupport, rateApp } from '../support/actions';
import { CHANGELOG, Release } from '../support/changelog';
import { WhatsNewSheet } from '../support/WhatsNewSheet';
import { Onboarding } from '../onboarding/Onboarding';
import { useAccounts } from '../hosts/accounts';
import { useAiSettings } from '../ai/settings';
import { iconsSupported, setMidnightIcon, usingMidnightIcon } from './appIcon';
import { CodeFontSection } from './CodeFontSection';
import { SaveFormattingRows } from './SaveFormattingRows';
import { ThemeGrid } from './ThemeGrid';

export function SettingsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const theme = useSettings((s) => s.theme);
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const terminalFontSize = useSettings((s) => s.terminalFontSize);
  const crashReports = useSettings((s) => s.crashReports);
  const haptics = useSettings((s) => s.haptics);
  const liveActivities = useSettings((s) => s.liveActivities);
  const keepAwake = useSettings((s) => s.keepAwake);
  const contrast = useSettings((s) => s.contrast);
  const matchChrome = useSettings((s) => s.matchChrome);
  const themesOn = useExtensions((s) => isActive(s, 'themes'));
  const chromeTheme = useChromeTheme();
  const keymap = useSettings((s) => s.keymap);
  const githubUser = useAccount((s) => s.user);
  useEffect(() => {
    accountStore.getState().refresh();
  }, []);
  const [icon, setIcon] = useState<'standard' | 'midnight'>(() => (usingMidnightIcon() ? 'midnight' : 'standard'));
  // The save options have their own rows (SaveFormattingRows).
  const editorOptions: Record<ViewOptionKey, boolean> = {
    wordWrap: useSettings((s) => s.wordWrap),
    folding: useSettings((s) => s.folding),
    indentGuides: useSettings((s) => s.indentGuides),
    minimap: useSettings((s) => s.minimap),
    emmet: useSettings((s) => s.emmet),
    errorLens: useSettings((s) => s.errorLens),
  };
  const snippetCount = useSettings((s) => s.snippets.length);
  const aiKey = useAiSettings((s) => s.hasKey);
  const hostCount = useAccounts((s) => s.accounts.length);
  const colors = useColors();
  const remote = useRemoteSettings((s) => s.settings);
  const git = useGitSettings((s) => s.settings);
  const installed = useExtensions((s) => s.installed.length);
  const settings = settingsStore.getState();
  const [whatsNew, setWhatsNew] = useState<Release[] | null>(null);
  const [tour, setTour] = useState(false);
  const support = (kind: 'bug' | 'feature') => contactSupport(kind).catch((e: Error) => Alert.alert("Couldn't open mail", e.message));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <Text variant="title">Settings</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Section title="Appearance">
          <Row label="Theme">
            <Segmented<ThemeSetting>
              testID="theme"
              value={theme}
              onChange={(t) => settings.setTheme(t)}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </Row>
          {chromeTheme && (
            <Text variant="muted" style={styles.hint}>
              {chromeTheme.name} is {chromeTheme.dark ? 'dark' : 'light'}, so the app is too.
            </Text>
          )}
          <ThemeGrid />
          {themesOn && (
            <Row label="Match the whole app to the theme">
              <Switch
                testID="match-chrome"
                value={matchChrome}
                onValueChange={(on) => settings.setMatchChrome(on)}
                trackColor={{ true: colors.brand, false: colors.secondary }}
              />
            </Row>
          )}
          {iconsSupported() && (
            <Row label="App icon">
              <Segmented<'standard' | 'midnight'>
                testID="app-icon"
                value={icon}
                onChange={(next) =>
                  setMidnightIcon(next === 'midnight').then(
                    () => setIcon(usingMidnightIcon() ? 'midnight' : 'standard'),
                    () => undefined,
                  )
                }
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'midnight', label: 'Midnight' },
                ]}
              />
            </Row>
          )}
          <Row label="Contrast">
            <Segmented<ContrastSetting>
              testID="contrast"
              value={contrast}
              onChange={(c) => settings.setContrast(c)}
              options={[
                { value: 'system', label: 'System' },
                { value: 'standard', label: 'Standard' },
                { value: 'high', label: 'High' },
              ]}
            />
          </Row>
          <Row label="Editor font size">
            <Stepper testID="editor-font" value={editorFontSize} onChange={(n) => settings.setEditorFontSize(n)} />
          </Row>
          <Row label="Terminal font size">
            <Stepper testID="terminal-font" value={terminalFontSize} onChange={(n) => settings.setTerminalFontSize(n)} />
          </Row>
        </Section>

        <CodeFontSection />

        <Section title="Editor">
          {(
            [
              ['wordWrap', 'Word wrap'],
              ['folding', 'Code folding'],
              ['indentGuides', 'Indent guides'],
              ['minimap', 'Minimap (iPad and wide windows)'],
              ['errorLens', 'Show problems at the end of the line'],
            ] as [ViewOptionKey, string][]
          ).map(([key, label]) => (
            <Row key={key} label={label}>
              <Switch
                testID={`editor-${key}`}
                value={editorOptions[key]}
                onValueChange={(on) => settings.setEditorOption(key, on)}
                trackColor={{ true: colors.brand, false: colors.secondary }}
              />
            </Row>
          ))}
          <Row label="Emmet">
            <Switch
              testID="editor-emmet"
              value={editorOptions.emmet}
              onValueChange={(on) => settings.setEditorOption('emmet', on)}
              trackColor={{ true: colors.brand, false: colors.secondary }}
            />
          </Row>
          <SaveFormattingRows />
          <LinkRow label="AI assistant" detail={aiKey ? 'Connected · models, completions and spend limit' : 'Claude, GPT, Gemini or your own server, with your own key'} onPress={() => router.push('/settings/ai')} testID="settings-ai" />
          <LinkRow
            label="Snippets"
            detail={snippetCount ? `${snippetCount} saved` : 'Your own, with tab stops'}
            onPress={() => router.push('/settings/snippets')}
            testID="settings-snippets"
          />
          <LinkRow label="Gestures" detail="Swipe, pinch and pull in the editor" onPress={() => router.push('/settings/gestures')} testID="settings-gestures" />
          <Row label="Key bindings">
            <Segmented<KeymapSetting>
              testID="editor-keymap"
              value={keymap}
              onChange={(k) => settings.setKeymap(k)}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'vim', label: 'Vim' },
                { value: 'emacs', label: 'Emacs' },
              ]}
            />
          </Row>
        </Section>

        <Section title="Keyboard">
          <LinkRow label="Key bar" detail="Keys above the keyboard" onPress={() => router.push('/settings/keys')} testID="settings-keybar" />
          <Row label="Haptics">
            <Switch
              testID="settings-haptics"
              value={haptics}
              onValueChange={(on) => settings.setHaptics(on)}
              trackColor={{ true: colors.brand, false: colors.secondary }}
            />
          </Row>
          {Platform.OS === 'ios' && (
            <Row label="Live Activities for runs and tests">
              <Switch
                testID="settings-live-activities"
                value={liveActivities}
                onValueChange={(on) => settings.setLiveActivities(on)}
                trackColor={{ true: colors.brand, false: colors.secondary }}
              />
            </Row>
          )}
          <Row label="Keep screen awake while running">
            <Switch
              testID="settings-keep-awake"
              value={keepAwake}
              onValueChange={(on) => settings.setKeepAwake(on)}
              trackColor={{ true: colors.brand, false: colors.secondary }}
            />
          </Row>
          <Text variant="muted" style={styles.note}>
            The screen doesn't lock while a program, task, test run or dev server runs in a terminal, Local or Remote. It locks as usual once they finish.
          </Text>
        </Section>

        <Section title="Extensions">
          <LinkRow
            label="Extensions"
            detail={installed ? `${installed} installed` : 'Themes, linting, Git tools and more'}
            onPress={() => router.push('/extensions')}
            testID="settings-extensions"
          />
        </Section>

        <Section title="Git">
          <LinkRow
            label="GitHub"
            detail={githubUser ? `Signed in as ${githubUser.login}` : 'Repositories, pull requests, issues and Actions'}
            onPress={() => router.push('/github/account')}
            testID="settings-github"
          />
          <LinkRow
            label="GitLab and Bitbucket"
            detail={hostCount ? `${hostCount} ${hostCount === 1 ? 'account' : 'accounts'}` : 'Clone, merge requests, pull requests and issues'}
            onPress={() => router.push('/hosts')}
            testID="settings-hosts"
          />
          <LinkRow
            label="Identity and token"
            detail={git.name ? `${git.name}${git.token ? ', token set' : ''}` : 'Not set up'}
            onPress={() => router.push('/settings/git')}
            testID="settings-git"
          />
        </Section>

        <Section title="Remote">
          <LinkRow
            label="Remote server"
            detail={remote ? remote.url : 'Not set up'}
            onPress={() => router.push('/settings/remote')}
            testID="settings-remote"
          />
        </Section>

        <Section title="Help & feedback">
          <LinkRow label="Report a problem" detail="Mail with device details and recent logs" onPress={() => support('bug')} testID="settings-report" />
          <LinkRow label="Suggest a feature" onPress={() => support('feature')} testID="settings-feature" />
          <LinkRow label="Rate Tide" onPress={() => rateApp().catch(() => undefined)} testID="settings-rate" />
          <LinkRow label="Take the tour" detail="The basics, in six screens" onPress={() => setTour(true)} testID="settings-tour" />
          <LinkRow label="What's new" detail={`Version ${appVersion()}`} onPress={() => setWhatsNew(CHANGELOG)} testID="settings-whats-new" />
        </Section>

        {crashReportsAvailable && (
          <Section title="Privacy">
            <Row label="Send crash reports">
              <Switch
                testID="crash-reports"
                value={crashReports}
                onValueChange={(on) => settings.setCrashReports(on)}
                trackColor={{ true: colors.brand, false: colors.secondary }}
              />
            </Row>
            <Text variant="muted" style={styles.note}>
              Sends crash details to Sentry. Reports never include your code, file contents, project names or terminal output.
            </Text>
          </Section>
        )}
      </ScrollView>
      <WhatsNewSheet releases={whatsNew} onClose={() => setWhatsNew(null)} />
      <Onboarding
        visible={tour}
        onDone={(create) => {
          setTour(false);
          if (create) router.navigate('/?new=1');
        }}
      />
    </View>
  );
}

type ViewOptionKey = Exclude<EditorOptionKey, 'trimTrailingWhitespace' | 'insertFinalNewline'>;

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

function Row({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text variant="label" style={styles.rowLabel}>
        {label}
      </Text>
      {children}
    </View>
  );
}

export function LinkRow({ label, detail, onPress, testID }: { label: string; detail?: string; onPress(): void; testID?: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* The detail goes under the label, so neither gets cut off on a phone. */}
      <View style={styles.rowLabel}>
        <Text variant="label">{label}</Text>
        {detail ? (
          <Text variant="muted" numberOfLines={2} style={styles.detail}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function Stepper({ value, onChange, testID }: { value: number; onChange(n: number): void; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stepper}>
      <IconButton icon="minus" label="Smaller" onPress={() => value > FONT_SIZE_MIN && onChange(value - 1)} testID={`${testID}-down`} />
      <Text variant="mono" style={styles.stepValue} testID={`${testID}-value`}>
        {value}
      </Text>
      <IconButton icon="plus" label="Larger" onPress={() => value < FONT_SIZE_MAX && onChange(value + 1)} testID={`${testID}-up`} />
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
  content: { padding: spacing.md, gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionTitle: { paddingHorizontal: spacing.xs },
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
  rowLabel: { flex: 1 },
  detail: { fontSize: fontSizes.sm, marginTop: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepValue: { minWidth: 24, textAlign: 'center' },
  note: { padding: spacing.md },
  hint: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, fontSize: fontSizes.sm },
}));
