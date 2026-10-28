import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useProjects, workspace } from '../../state';
import { colors, extended, fonts, fontSizes, lineHeights, spacing } from '../../theme/tokens';

interface FileViewProps {
  project: string;
  path: string | null;
  onBrowse(): void;
}

const LINE_HEIGHT = Math.round(fontSizes.sm * lineHeights.code);

// Read-only view of the active file until the CodeMirror editor lands.
export function FileView({ project, path, onBrowse }: FileViewProps) {
  const tree = useProjects((s) => s.trees[project]);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    if (!path) return;
    workspace
      .readFile(project, path)
      .then((text) => !cancelled && setContent(text))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // Re-read when the tree changes, e.g. after a rename elsewhere.
  }, [project, path, tree]);

  if (!path) {
    return (
      <View style={styles.empty}>
        <Text variant="muted">No file open.</Text>
        <Button title="Browse files" variant="outline" icon="sidebar" onPress={onBrowse} />
      </View>
    );
  }
  if (error) return <Text variant="error" style={styles.message}>{error}</Text>;
  if (content === null) return null;

  const lines = content.split('\n');
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.code} testID="file-view">
      <View style={styles.gutter}>
        {lines.map((_, i) => (
          <Text key={i} style={styles.lineNo}>
            {i + 1}
          </Text>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text variant="mono" style={styles.text} selectable>
          {content}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  message: { padding: spacing.md },
  scroll: { flex: 1 },
  code: { flexDirection: 'row', paddingVertical: spacing.sm },
  gutter: { paddingHorizontal: spacing.sm, alignItems: 'flex-end' },
  lineNo: { fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, lineHeight: LINE_HEIGHT, color: extended.dark.dim },
  text: { lineHeight: LINE_HEIGHT, paddingRight: spacing.md, color: colors.foreground },
});
