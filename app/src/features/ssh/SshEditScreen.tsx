import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, TextInput } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Loading, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { fonts, fontSizes, spacing } from '../../theme/tokens';
import { fromBase64, toBase64 } from '../backup/zip';
import { classify } from '../editor/largeFiles';
import { useSftp } from './SftpScreen';
import { useSsh } from './store';

// A remote text file, opened over SFTP and saved straight back.
export function SshEditScreen() {
  const { id, path } = useLocalSearchParams<{ id: string; path: string }>();
  const styles = useStyles();
  const colors = useColors();
  const host = useSsh((s) => s.hosts.find((h) => h.id === id));
  const sftp = useSftp(host);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sftp) return;
    sftp.ready
      .then((s) => s.read(path))
      .then(({ base64 }) => {
        const content = new TextDecoder().decode(fromBase64(base64));
        if (classify(content) === 'binary') throw new Error('This is a binary file. Copy it to a project to work with it.');
        setText(content);
        setSaved(content);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sftp, path]);

  const save = async () => {
    if (text === null || !sftp) return;
    setSaving(true);
    try {
      await (await sftp.ready).writeFile(path, toBase64(new TextEncoder().encode(text)));
      setSaved(text);
      haptic('success');
    } catch (e) {
      haptic('error');
      Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title={path.split('/').pop() ?? path}
      subtitle={`${host?.name ?? ''} · ${path}`}
      scroll={false}
      actions={<Button title={saving ? 'Saving…' : text !== saved ? 'Save' : 'Saved'} onPress={save} disabled={saving || text === null || text === saved} testID="ssh-save" />}
    >
      {error && <Text variant="error" style={styles.pad} selectable>{error}</Text>}
      {text === null && !error && <Loading />}
      {text !== null && (
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          scrollEnabled
          selectionColor={colors.brand}
          style={styles.editor}
          testID="ssh-editor"
        />
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  pad: { padding: spacing.md },
  editor: { flex: 1, padding: spacing.md, color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, textAlignVertical: 'top' },
}));
