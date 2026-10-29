import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { ReactNode, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { EditorOptionKey, FONT_SIZE_MAX, FONT_SIZE_MIN, ThemeSetting } from '../../state/settings';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { useExtensions } from '../../extensions/state';
import { useGitSettings } from '../git/settings';
import { crashReportsAvailable } from '../privacy/crashReports';
import { useRemoteSettings } from '../remote/settings';
import { appVersion, contactSupport, rateApp } from '../support/actions';
import { CHANGELOG, Release } from '../support/changelog';
import { WhatsNewSheet } from '../support/WhatsNewSheet';

export function SettingsScreen() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const theme = useSettings((s) => s.theme);
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const terminalFontSize = useSettings((s) => s.terminalFontSize);
  const crashReports = useSettings((s) => s.crashReports);
  const haptics = useSettings((s) => s.haptics);
  const editorOptions: Record<EditorOptionKey, boolean> = {
    wordWrap: useSettings((s) => s.wordWrap),
    folding: useSettings((s) => s.folding),
    indentGuides: useSettings((s) => s.indentGuides),
    minimap: useSettings((s) => s.minimap),
  };
  const colors = useColors();
  const remote = useRemoteSettings((s) => s.settings);
  const git = useGitSettings((s) => s.settings);
  const owned = useExtensions((s) => s.owned.length);
  const settings = settingsStore.getState();
  const [whatsNew, setWhatsNew] = useState<Release[] | null>(null);
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
          <Row label="Editor font size">
            <Stepper testID="editor-font" value={editorFontSize} onChange={(n) => settings.setEditorFontSize(n)} />
          </Row>
          <Row label="Terminal font size">
            <Stepper testID="terminal-font" value={terminalFontSize} onChange={(n) => settings.setTerminalFontSize(n)} />
          </Row>
        </Section>

        <Section title="Editor">
          {(
            [
              ['wordWrap', 'Word wrap'],
              ['folding', 'Code folding'],
              ['indentGuides', 'Indent guides'],
              ['minimap', 'Minimap'],
            ] as [EditorOptionKey, string][]
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
        </Section>

        <Section title="Extensions">
          <LinkRow
            label="Extensions"
            detail={owned ? `${owned} installed` : 'Themes, linting, Git Pro and more'}
            onPress={() => router.push('/extensions')}
            testID="settings-extensions"
          />
        </Section>

        <Section title="Git">
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
    </View>
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
      <Text variant="label" style={styles.rowLabel}>
        {label}
      </Text>
      {detail ? (
        <Text variant="muted" numberOfLines={1} style={styles.detail}>
          {detail}
        </Text>
      ) : null}
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
  detail: { maxWidth: '50%' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepValue: { minWidth: 24, textAlign: 'center' },
  note: { padding: spacing.md },
}));
