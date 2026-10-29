import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { templates } from '../files/templates';
import { repoName } from '../git/runGit';
import { makeStyles, useColors } from '../../theme/theme';

interface NewProjectSheetProps {
  visible: boolean;
  onCreate(name: string, templateId: string): Promise<void>;
  onClone(name: string, url: string): Promise<void>;
  // Asks for a .zip; the name defaults to the zip's.
  onImport(name: string): Promise<void>;
  // Asks for a folder in Files and links the project to it; the name defaults to the folder's.
  onOpenFolder(name: string): Promise<void>;
  onClose(): void;
}

const CLONE = 'clone';
const IMPORT = 'import';
const FOLDER = 'folder';

export function NewProjectSheet({ visible, onCreate, onClone, onImport, onOpenFolder, onClose }: NewProjectSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setUrl('');
      setTemplateId(templates[0].id);
      setError(null);
    }
  }, [visible]);

  async function create() {
    setBusy(true);
    try {
      if (templateId === CLONE) await onClone(name.trim() || repoName(url), url.trim());
      else if (templateId === IMPORT) await onImport(name.trim());
      else if (templateId === FOLDER) await onOpenFolder(name.trim());
      else await onCreate(name, templateId);
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
          placeholder={templateId === CLONE ? 'Project name (default: repository name)' : templateId === FOLDER ? 'Project name (default: folder name)' : 'Project name'}
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
        {templateId === CLONE && (
          <TextInput
            testID="clone-url"
            value={url}
            onChangeText={(v) => {
              setUrl(v);
              setError(null);
            }}
            placeholder="https://github.com/user/repo.git"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            spellCheck={false}
            selectionColor={colors.brand}
            style={styles.input}
          />
        )}
        {error && <Text variant="error">{error}</Text>}
      </View>
      <View style={styles.templates} accessibilityRole="radiogroup">
        {[
          ...templates,
          { id: CLONE, label: 'Clone from Git', description: 'Clone a repository over HTTPS. Private ones need a token in Settings, Git.' },
          { id: FOLDER, label: 'Open a folder', description: 'Work on a folder from Files, iCloud Drive or another app, and sync changes back to it.' },
          { id: IMPORT, label: 'Import a .zip', description: 'Pick a .zip, from Files or iCloud Drive; its files become the project.' },
        ].map((t) => {
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
        <Button
          title={busy && templateId === CLONE ? 'Cloning...' : templateId === CLONE ? 'Clone' : templateId === IMPORT ? 'Choose .zip' : templateId === FOLDER ? 'Choose folder' : 'Create'}
          onPress={create}
          disabled={busy || (templateId === CLONE && !url.trim())}
          testID="create-project"
        />
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
}));
