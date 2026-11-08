import { Switch, View } from 'react-native';

import { Text } from '../../components/Text';
import { settingsStore, useSettings } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, spacing } from '../../theme/tokens';

const ROWS = [
  {
    key: 'trimTrailingWhitespace',
    label: 'Trim trailing whitespace on save',
    detail: "Autosave too, but not on the line you're typing. Two spaces at the end of a Markdown line are a line break and stay. A file's .editorconfig wins.",
  },
  {
    key: 'insertFinalNewline',
    label: 'Insert final newline on save',
    detail: "Ends the file with a newline. A file's .editorconfig wins.",
  },
] as const;

// Rows in Settings > Editor for what happens to text when it's saved.
export function SaveFormattingRows() {
  const styles = useStyles();
  const colors = useColors();
  const values = {
    trimTrailingWhitespace: useSettings((s) => s.trimTrailingWhitespace) === true,
    insertFinalNewline: useSettings((s) => s.insertFinalNewline) === true,
  };
  return (
    <>
      {ROWS.map(({ key, label, detail }) => (
        <View key={key} style={styles.row}>
          {/* The detail goes under the label, so neither gets cut off on a phone. */}
          <View style={styles.label}>
            <Text variant="label">{label}</Text>
            <Text variant="muted" style={styles.detail}>
              {detail}
            </Text>
          </View>
          <Switch
            testID={`editor-${key}`}
            accessibilityLabel={label}
            accessibilityHint={detail}
            value={values[key]}
            onValueChange={(on) => settingsStore.getState().setEditorOption(key, on)}
            trackColor={{ true: colors.brand, false: colors.secondary }}
          />
        </View>
      ))}
    </>
  );
}

const useStyles = makeStyles((colors) => ({
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
  label: { flex: 1 },
  detail: { fontSize: fontSizes.sm, marginTop: 1 },
}));
