import Feather from '@expo/vector-icons/Feather';
import { Pressable, ScrollView, View } from 'react-native';

import { FileBadge } from '../../components/FileBadge';
import { Text } from '../../components/Text';
import { borderWidth, fonts, radius, spacing } from '../../theme/tokens';
import { FileIcon } from '../../extensions/themes';
import { basename } from '../files/fs';
import { makeStyles, useColors } from '../../theme/theme';

interface TabBarProps {
  open: string[];
  active: string | null;
  dirty: Set<string>;
  onSelect(path: string): void;
  onClose(path: string): void;
}

const folderOf = (path: string) => (path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '');

// One compact row like a desktop editor's: the active tab also shows its
// folder, which stands in for a separate breadcrumbs row on phones.
export function TabBar({ open, active, dirty, onSelect, onClose }: TabBarProps) {
  const styles = useStyles();
  const colors = useColors();
  if (open.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content}>
      {open.map((path) => {
        const selected = path === active;
        const name = basename(path);
        const folder = selected ? folderOf(path) : '';
        return (
          <Pressable
            key={path}
            testID={`tab-${path}`}
            onPress={() => onSelect(path)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityHint={path}
            style={({ pressed }) => [styles.tab, selected && styles.selected, pressed && !selected && styles.pressed]}
          >
            <FileIcon name={name} fallback={<FileBadge name={name} size={14} />} />
            <Text style={[styles.name, { color: selected ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
              {folder ? <Text style={[styles.name, { color: colors.mutedForeground }]}>{folder.length > 18 ? `…${folder.slice(-17)}` : folder}</Text> : null}
              {name}
            </Text>
            <Pressable accessibilityRole="button" hitSlop={spacing.sm} onPress={() => onClose(path)} accessibilityLabel={`Close ${name}`} style={styles.close}>
              {dirty.has(path) ? (
                <View style={styles.dirty} accessibilityLabel="Unsaved changes" testID={`dirty-${path}`} />
              ) : (
                <Feather name="x" size={13} color={colors.mutedForeground} />
              )}
            </Pressable>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { flexGrow: 0, borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  content: { alignItems: 'stretch' },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingLeft: spacing.sm + 4,
    paddingRight: spacing.sm,
    borderRightWidth: borderWidth,
    borderTopWidth: 2,
    borderColor: colors.border,
    borderTopColor: 'transparent',
    maxWidth: 240,
  },
  // The active tab joins the editor below it, with an accent along the top.
  selected: { backgroundColor: colors.background, borderTopColor: colors.brand },
  pressed: { backgroundColor: colors.secondary },
  name: { fontFamily: fonts.sans.regular, fontSize: 13, flexShrink: 1 },
  close: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as the close icon so tabs don't shift when the dot appears.
  dirty: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.foreground, opacity: 0.8 },
}));
