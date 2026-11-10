import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { makeStyles, useColors } from '../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../theme/tokens';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';

export interface FormField {
  key: string;
  label: string;
  placeholder?: string;
  initial?: string;
  multiline?: boolean;
  secure?: boolean;
  mono?: boolean;
  keyboardType?: 'default' | 'url' | 'email-address' | 'number-pad';
  // Shown as chips to pick from instead of a text box.
  choices?: { value: string; label: string }[];
  // Must be filled in before the confirm button turns on.
  required?: boolean;
  hint?: string;
}

interface FormSheetProps {
  visible: boolean;
  title: string;
  description?: string;
  fields: FormField[];
  confirmLabel: string;
  // Throwing shows the error message and keeps the sheet open.
  onSubmit(values: Record<string, string>): Promise<void>;
  onClose(): void;
}

// A sheet with a few labelled fields: comments, new issues, server details, tokens.
export function FormSheet({ visible, title, description, fields, confirmLabel, onSubmit, onClose }: FormSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const initial = () => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? f.choices?.[0]?.value ?? '']));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setValues(initial());
      setError(null);
    }
    // Fields are rebuilt on every render by callers; reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const ready = fields.every((f) => !f.required || values[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} scrollable>
      <Text variant="title">{title}</Text>
      {description ? <Text variant="muted">{description}</Text> : null}
      {fields.map((f, i) => (
        <View key={f.key} style={styles.field}>
          <Text variant="label">{f.label}</Text>
          {f.choices ? (
            <View style={styles.choices}>
              {f.choices.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setValues((v) => ({ ...v, [f.key]: c.value }))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: values[f.key] === c.value }}
                  style={[styles.choice, values[f.key] === c.value && styles.choiceOn]}
                  testID={`form-${f.key}-${c.value}`}
                >
                  <Text variant="label">{c.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <TextInput
              testID={`form-${f.key}`}
              value={values[f.key]}
              onChangeText={(t) => {
                setValues((v) => ({ ...v, [f.key]: t }));
                setError(null);
              }}
              placeholder={f.placeholder}
              placeholderTextColor={colors.mutedForeground}
              autoFocus={i === 0 && !f.choices}
              autoCapitalize={f.mono || f.secure || f.keyboardType === 'url' ? 'none' : 'sentences'}
              autoCorrect={!f.mono && !f.secure}
              spellCheck={!f.mono && !f.secure}
              secureTextEntry={f.secure}
              // Secret fields hold tokens, not logins: keep iOS from offering to save them to Passwords.
              textContentType={f.secure ? 'none' : undefined}
              autoComplete={f.secure ? 'off' : undefined}
              keyboardType={f.keyboardType ?? 'default'}
              multiline={f.multiline}
              selectionColor={colors.brand}
              style={[styles.input, f.multiline && styles.multiline, f.mono && styles.mono]}
            />
          )}
          {f.hint ? <Text variant="muted">{f.hint}</Text> : null}
        </View>
      ))}
      {error && (
        <Text variant="error" selectable>
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <Button title="Cancel" variant="outline" onPress={onClose} />
        <Button title={busy ? 'Working…' : confirmLabel} onPress={submit} disabled={busy || !ready} testID="form-submit" />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  field: { gap: spacing.xs },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.sans.regular,
    fontSize: fontSizes.md,
  },
  multiline: { minHeight: 120, maxHeight: 260, textAlignVertical: 'top' },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.xs + 2, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  choiceOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
