import { Icon } from '../../components/Icon';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable } from 'react-native';

import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { useReduceMotion } from '../../components/a11y';
import { borderWidth, fonts, radius, spacing } from '../../theme/tokens';
import { manifestFor } from '../manifests';
import { extensionsStore, useExtensions } from '../state';
import { dependenciesOf, ProjectFacts, suggestExtension } from './suggest';

// How long the toast stays before it slides away for this session; "Not
// now" (the x) is what remembers the answer.
const VISIBLE_MS = 12000;

// A floating toast over the editor offering a free extension that fits the
// project. It never pushes the code down.
export function SuggestionBanner({ project, bottom = 12 }: { project: string; bottom?: number }) {
  const styles = useStyles();
  const colors = useColors();
  const [facts, setFacts] = useState<ProjectFacts | null>(null);
  const installed = useExtensions((s) => s.installed);
  const dismissed = useExtensions((s) => s.dismissed[project]);
  const [hidden, setHidden] = useState(false);
  const shown = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

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
  const id = suggestion?.id;
  useEffect(() => {
    if (!id) return;
    Animated.timing(shown, { toValue: 1, duration: reduceMotion ? 0 : 220, useNativeDriver: true }).start();
    const t = setTimeout(() => Animated.timing(shown, { toValue: 0, duration: reduceMotion ? 0 : 220, useNativeDriver: true }).start(() => setHidden(true)), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [id, shown, reduceMotion]);
  if (!suggestion || hidden) return null;
  const { name } = manifestFor(suggestion.id);
  return (
    <Animated.View
      style={[styles.banner, { bottom, opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }]}
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      testID="extension-suggestion"
    >
      <Icon name="package" size={16} color={colors.brand} />
      <Text style={styles.flex} numberOfLines={2}>
        {suggestion.reason}
      </Text>
      <Pressable
        onPress={() => {
          extensionsStore.getState().install(suggestion.id);
          haptic('success');
        }}
        accessibilityRole="button"
        accessibilityLabel={`Install ${name}`}
        style={[styles.install, { backgroundColor: colors.brand }]}
        testID="suggestion-install"
      >
        <Text style={[styles.installText, { color: colors.brandForeground }]}>Install</Text>
      </Pressable>
      <Pressable onPress={() => extensionsStore.getState().dismiss(project, suggestion.id)} accessibilityRole="button" accessibilityLabel="Not now" hitSlop={8} testID="suggestion-dismiss">
        <Icon name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  banner: {
    position: 'absolute',
    left: spacing.sm + 4,
    right: spacing.sm + 4,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.secondary,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  flex: { flex: 1, fontSize: 12.5, lineHeight: 16 },
  install: { paddingHorizontal: spacing.sm + 4, paddingVertical: 6, borderRadius: radius.sm },
  installText: { fontFamily: fonts.sans.semibold, fontSize: 12.5 },
}));
