import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { borderWidth, colors, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { templates } from '../files/templates';

interface NewProjectSheetProps {
  visible: boolean;
  onCreate(name: string, templateId: string): Promise<void>;
  onClose(): void;
}

export function NewProjectSheet({ visible, onCreate, onClose }: NewProjectSheetProps) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setTemplateId(templates[0].id);
      setError(null);
    }
  }, [visible]);

  async function create() {
    setBusy(true);
    try {
      await onCreate(name, templateId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">New project</Text>
      <View style={styles.field}>
        <TextInput
          testID="project-name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            setError(null);
          }}
          placeholder="Project name"
          placeholderTextColor={colors.mutedForeground}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          spellCheck={false}
          selectionColor={colors.brand}
          style={styles.input}
        />
        {error && <Text variant="error">{error}</Text>}
      </View>
      <View style={styles.templates} accessibilityRole="radiogroup">
        {templates.map((t) => {
          const selected = t.id === templateId;
          return (
            <Pressable
              key={t.id}
              testID={`template-${t.id}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setTemplateId(t.id)}
              style={[styles.template, selected && styles.selected]}
            >
              <Text variant="label">{t.label}</Text>
              <Text variant="muted">{t.description}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.actions}>
        <Button title="Cancel" variant="outline" onPress={onClose} />
        <Button title="Create" onPress={create} disabled={busy} testID="create-project" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
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
  templates: { gap: spacing.sm },
  template: {
    gap: 2,
    padding: spacing.sm + 4,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
