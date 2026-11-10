import { Icon } from '../../components/Icon';
import { useFonts } from 'expo-font';
import { Pressable, Switch, View } from 'react-native';

import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { CODE_FONTS, CodeFont, DEFAULT_CODE_FONT } from '../editor/bridge';

const SAMPLE = 'const ok = (a, b) => a !== b && a >= 0;';

const ORDER: CodeFont[] = ['jetbrains-mono', 'fira-code', 'ibm-plex-mono', 'source-code-pro'];

// What each font's ligature support means for the toggle, so it doesn't look broken.
const NOTES: Record<CodeFont, string> = {
  'jetbrains-mono': 'Default',
  'fira-code': 'Ligatures',
  'ibm-plex-mono': 'No ligatures',
  'source-code-pro': 'No ligatures',
};

// JetBrains Mono ships natively (app.json expo-font plugin). The others are
// loaded here, when Settings opens, so app start doesn't pay for them. The
// keys are the PostScript names, the same strings the native embedding uses.
const EXTRA_FONTS = {
  'FiraCode-Regular': require('../../../assets/fonts/FiraCode-Regular.ttf'),
  'IBMPlexMono-Regular': require('../../../assets/fonts/IBMPlexMono-Regular.ttf'),
  'SourceCodePro-Regular': require('../../../assets/fonts/SourceCodePro-Regular.ttf'),
};

export function CodeFontSection() {
  const styles = useStyles();
  const colors = useColors();
  const codeFont = useSettings((s) => s.codeFont) ?? DEFAULT_CODE_FONT;
  const ligatures = useSettings((s) => s.ligatures);
  // Until a font loads, its sample falls back to the system font for a moment.
  const [loaded] = useFonts(EXTRA_FONTS);
  const settings = settingsStore.getState();

  return (
    <View style={styles.section}>
      <Text variant="muted" style={styles.sectionTitle}>
        Code font
      </Text>
      <View style={styles.card} accessibilityRole="radiogroup">
        {ORDER.map((id) => {
          const font = CODE_FONTS[id];
          const selected = id === codeFont;
          const ready = loaded || id === 'jetbrains-mono';
          return (
            <Pressable
              key={id}
              testID={`code-font-${id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${font.name}, ${NOTES[id]}`}
              onPress={() => settings.setCodeFont(id)}
              style={({ pressed }) => [styles.row, selected && styles.selected, pressed && !selected && styles.pressed]}
            >
              <View style={styles.rowLabel}>
                <View style={styles.nameLine}>
                  <Text variant="label">{font.name}</Text>
                  <Text variant="muted" style={styles.note}>
                    {NOTES[id]}
                  </Text>
                </View>
                <Text
                  variant="mono"
                  numberOfLines={1}
                  // The sample shows what the toggle below does.
                  style={[styles.sample, ready && { fontFamily: font.postScript }, { fontVariant: ligatures ? ['common-ligatures', 'contextual'] : ['no-common-ligatures', 'no-contextual'] }]}
                >
                  {SAMPLE}
                </Text>
              </View>
              {selected ? <Icon name="check" size={18} color={colors.brand} /> : <View style={styles.checkSpace} />}
            </Pressable>
          );
        })}
        <View style={styles.row}>
          <Text variant="label" style={styles.rowLabel}>
            Ligatures (=&gt; ≠ ≥)
          </Text>
          <Switch
            testID="code-font-ligatures"
            value={ligatures}
            onValueChange={(on) => settings.setLigatures(on)}
            trackColor={{ true: colors.brand, false: colors.secondary }}
          />
        </View>
      </View>
    </View>
  );
}

// Matches the Section and Row look in SettingsScreen.
const useStyles = makeStyles((colors) => ({
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
  selected: { backgroundColor: colors.brandSoft },
  pressed: { backgroundColor: colors.secondary },
  rowLabel: { flex: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  note: { fontSize: fontSizes.xs },
  sample: { marginTop: 4, color: colors.mutedForeground },
  checkSpace: { width: 18 },
}));
