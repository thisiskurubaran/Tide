import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { borderWidth, fonts, fontSizes, radius, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { makeStyles, useColors } from '../theme/theme';

interface PromptSheetProps {
  visible: boolean;
  title: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel: string;
  keyboardType?: 'default' | 'number-pad';
  // Throwing shows the error message under the input and keeps the sheet open.
  onSubmit(value: string): Promise<void>;
  onClose(): void;
}

export function PromptSheet({ visible, title, initialValue = '', placeholder, confirmLabel, keyboardType = 'default', onSubmit, onClose }: PromptSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setError(null);
    }
  }, [visible, initialValue]);

  // Return can fire before the last keystroke re-renders, so take the text from the event when there is one.
  async function submit(text = value) {
    setBusy(true);
    try {
      await onSubmit(text);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} scrollable>
      <Text variant="title">{title}</Text>
      <View style={styles.field}>
        <TextInput
          testID="prompt-input"
          value={value}
          onChangeText={(v) => {
            setValue(v);
            setError(null);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          spellCheck={false}
          keyboardType={keyboardType}
          returnKeyType="done"
          onSubmitEditing={(e) => submit(e.nativeEvent.text)}
          selectionColor={colors.brand}
          style={styles.input}
        />
        {error && <Text variant="error">{error}</Text>}
      </View>
      <View style={styles.actions}>
        <Button title="Cancel" variant="outline" onPress={onClose} />
        <Button title={confirmLabel} onPress={() => submit()} disabled={busy} testID="prompt-confirm" />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  field: { gap: spacing.xs },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.md,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
