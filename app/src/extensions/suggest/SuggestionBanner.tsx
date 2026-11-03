import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import { manifestFor } from '../manifests';
import { extensionsStore, useExtensions } from '../state';
import { dependenciesOf, ProjectFacts, suggestExtension } from './suggest';

// One line under the tabs offering a free extension that fits the project.
export function SuggestionBanner({ project }: { project: string }) {
  const styles = useStyles();
  const colors = useColors();
  const [facts, setFacts] = useState<ProjectFacts | null>(null);
  const installed = useExtensions((s) => s.installed);
  const dismissed = useExtensions((s) => s.dismissed[project]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [files, pkg, git] = await Promise.all([
        workspace.listFiles(project).catch(() => [] as string[]),
        workspace.readFile(project, 'package.json').catch(() => null),
        workspace.stat(project, '.git').catch(() => null),
      ]);
      if (!cancelled) setFacts({ files, dependencies: dependenciesOf(pkg), isGitRepo: git === 'dir' });
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const suggestion = facts ? suggestExtension(facts, installed, dismissed ?? []) : null;
  if (!suggestion) return null;
  const { name } = manifestFor(suggestion.id);
  return (
    <View style={[styles.banner, { backgroundColor: colors.brandSoft }]} accessibilityRole="summary" testID="extension-suggestion">
      <Feather name="package" size={16} color={colors.brand} />
      <Text style={styles.flex} numberOfLines={3}>
        {suggestion.reason} <Text variant="muted">Free.</Text>
      </Text>
      <Pressable
        onPress={() => {
          extensionsStore.getState().install(suggestion.id);
          haptic('success');
        }}
        accessibilityRole="button"
        accessibilityLabel={`Install ${name}`}
        style={[styles.install, { backgroundColor: colors.foreground }]}
        testID="suggestion-install"
      >
        <Text style={[styles.installText, { color: colors.background }]}>Install</Text>
      </Pressable>
      <Pressable onPress={() => extensionsStore.getState().dismiss(project, suggestion.id)} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={8} testID="suggestion-dismiss">
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, marginHorizontal: spacing.sm, marginTop: spacing.xs, borderRadius: radius.md },
  flex: { flex: 1, fontSize: 13, lineHeight: 17 },
  install: { paddingHorizontal: spacing.sm + 4, paddingVertical: 5, borderRadius: radius.sm },
  installText: { fontWeight: '600', fontSize: 13 },
}));
