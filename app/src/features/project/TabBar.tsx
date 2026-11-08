import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Action, ActionSheet } from '../../components/ActionSheet';
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
  // Pinned tabs come first in `open`; they show a pin and skip "close others".
  pinned?: string[];
  onPin?(path: string): void;
  onUnpin?(path: string): void;
  onCloseOthers?(path: string): void;
  onReveal?(path: string): void;
  // Phones: pinned tabs drop their close button and stay narrow.
  compact?: boolean;
}

const folderOf = (path: string) => (path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/` : '');

// One compact row like a desktop editor's: the active tab also shows its
// folder, which stands in for a separate breadcrumbs row on phones.
export function TabBar({ open, active, dirty, onSelect, onClose, pinned = [], onPin, onUnpin, onCloseOthers, onReveal, compact = false }: TabBarProps) {
  const styles = useStyles();
  const colors = useColors();
  // The tab whose long-press menu is showing.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  if (open.length === 0) return null;
  const isPinned = (path: string) => pinned.includes(path);
  const togglePin = (path: string) => (isPinned(path) ? onUnpin?.(path) : onPin?.(path));
  const hasOthers = (path: string) => open.some((p) => p !== path && !isPinned(p));
  const menu = (path: string): Action[] => [
    ...(onPin && onUnpin
      ? [isPinned(path) ? { label: 'Unpin tab', icon: 'map-pin' as const, onPress: () => onUnpin(path) } : { label: 'Pin tab', icon: 'map-pin' as const, onPress: () => onPin(path) }]
      : []),
    ...(onReveal ? [{ label: 'Reveal in file tree', icon: 'sidebar' as const, onPress: () => onReveal(path) }] : []),
    { label: 'Close tab', icon: 'x', onPress: () => onClose(path) },
    ...(onCloseOthers && hasOthers(path) ? [{ label: 'Close other tabs', icon: 'x-square' as const, onPress: () => onCloseOthers(path) }] : []),
  ];
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.content}>
        {open.map((path) => {
          const selected = path === active;
          const name = basename(path);
          const folder = selected ? folderOf(path) : '';
          const unsaved = dirty.has(path);
          const pin = isPinned(path);
          // A pinned tab on a phone is just its icon and name, without the folder or close button.
          const narrow = pin && compact;
          const label = [name, pin && 'pinned', unsaved && 'unsaved changes'].filter(Boolean).join(', ');
          return (
            <Pressable
              key={path}
              testID={`tab-${path}`}
              onPress={() => onSelect(path)}
              onLongPress={() => setMenuFor(path)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              // VoiceOver reads the tab as one element, so the close button
              // inside it can't be reached on its own: closing is an action of
              // the tab (swipe up or down), and the unsaved dot is in the label.
              // Pinning and closing the others are actions too, like the long-press menu.
              accessibilityLabel={label}
              accessibilityHint={path}
              accessibilityActions={[
                { name: 'activate' },
                { name: 'close', label: `Close ${name}` },
                ...(onPin && onUnpin ? [{ name: pin ? 'unpin' : 'pin', label: `${pin ? 'Unpin' : 'Pin'} ${name}` }] : []),
                ...(onCloseOthers && hasOthers(path) ? [{ name: 'closeOthers', label: 'Close other tabs' }] : []),
              ]}
              onAccessibilityAction={(e) => {
                const action = e.nativeEvent.actionName;
                if (action === 'activate') onSelect(path);
                else if (action === 'close') onClose(path);
                else if (action === 'pin' || action === 'unpin') togglePin(path);
                else if (action === 'closeOthers') onCloseOthers?.(path);
              }}
              style={({ pressed }) => [styles.tab, narrow && styles.narrow, selected && styles.selected, pressed && !selected && styles.pressed]}
            >
              {pin && <Feather name="map-pin" size={11} color={colors.mutedForeground} testID={`pin-${path}`} />}
              <FileIcon name={name} fallback={<FileBadge name={name} size={14} />} />
              <Text style={[styles.name, { color: selected ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                {folder && !narrow ? (
                  <Text style={[styles.name, { color: colors.mutedForeground }]}>{folder.length > 18 ? `…${folder.slice(-17)}` : folder}</Text>
                ) : null}
                {name}
              </Text>
              {narrow ? (
                unsaved && <View style={styles.dirty} testID={`dirty-${path}`} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={spacing.sm}
                  onPress={() => onClose(path)}
                  accessibilityLabel={`Close ${name}`}
                  testID={`close-${path}`}
                  style={styles.close}
                >
                  {unsaved ? <View style={styles.dirty} testID={`dirty-${path}`} /> : <Feather name="x" size={13} color={colors.mutedForeground} />}
                </Pressable>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      <ActionSheet title={menuFor} actions={menuFor ? menu(menuFor) : []} onClose={() => setMenuFor(null)} />
    </>
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
  narrow: { maxWidth: 110, paddingLeft: spacing.sm },
  // The active tab joins the editor below it, with an accent along the top.
  selected: { backgroundColor: colors.background, borderTopColor: colors.brand },
  pressed: { backgroundColor: colors.secondary },
  name: { fontFamily: fonts.sans.regular, fontSize: 13, flexShrink: 1 },
  close: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  // Same footprint as the close icon so tabs don't shift when the dot appears.
  dirty: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.foreground, opacity: 0.8 },
}));
