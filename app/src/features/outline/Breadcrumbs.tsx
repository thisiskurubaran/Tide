import { Icon } from '../../components/Icon';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { createStore, useStore } from 'zustand';

import { Text } from '../../components/Text';
import { lineStarts, positionAt } from '../../extensions/diagnostics';
import { useBuffers } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, spacing } from '../../theme/tokens';
import { languageFor } from '../editor/bridge';
import { LARGE_CHARS } from '../editor/largeFiles';
import { symbolsAt } from './breadcrumbs';
import { CodeSymbol, symbolsFor } from './symbols';

// Where the editor's cursor is. Its own store, so moving the cursor re-renders
// the breadcrumbs and not the whole project screen.
export const cursorStore = createStore<{ path: string | null; offset: number }>(() => ({ path: null, offset: 0 }));

const ICONS: Record<CodeSymbol['kind'], 'box' | 'zap' | 'hash' | 'type' | 'list' | 'grid' | 'package'> = {
  class: 'box',
  function: 'zap',
  method: 'zap',
  variable: 'hash',
  type: 'type',
  heading: 'hash',
  selector: 'list',
  table: 'grid',
  module: 'package',
};

// src › utils › parse.ts › Parser › parse(): the open file's folders, and the
// symbols the cursor is in. Folders open the file tree; symbols jump to their line.
export function Breadcrumbs({ project, path, onShowFiles, onJump }: { project: string; path: string; onShowFiles(): void; onJump(line: number): void }) {
  const styles = useStyles();
  const colors = useColors();
  const content = useBuffers((s) => s.buffers[bufferKey(project, path)]?.content);
  const offset = useStore(cursorStore, (s) => (s.path === path ? s.offset : 0));
  const text = content && content.length <= LARGE_CHARS ? content : null;
  const symbols = useMemo(() => (text === null ? [] : symbolsFor(text, languageFor(path))), [text, path]);
  const lines = useMemo(() => (text === null ? [] : text.split('\n')), [text]);
  const line = useMemo(() => (text === null ? 1 : positionAt(lineStarts(text), offset).line), [text, offset]);
  const chain = useMemo(() => symbolsAt(symbols, lines, line), [symbols, lines, line]);
  const parts = path.split('/');

  const sep = <Icon name="chevron-right" size={12} color={colors.mutedForeground} />;
  return (
    <View style={styles.bar} testID="breadcrumbs">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {parts.map((part, i) => (
          <View key={`p${i}`} style={styles.item}>
            {i > 0 && sep}
            <Pressable onPress={onShowFiles} accessibilityRole="button" accessibilityHint="Shows the files" hitSlop={6}>
              <Text style={[styles.text, i === parts.length - 1 ? styles.file : null]} numberOfLines={1}>
                {part}
              </Text>
            </Pressable>
          </View>
        ))}
        {chain.map((s) => (
          <View key={`s${s.line}`} style={styles.item}>
            {sep}
            <Pressable onPress={() => onJump(s.line)} accessibilityRole="button" accessibilityLabel={`${s.kind} ${s.name}, line ${s.line}`} hitSlop={6} style={styles.symbol} testID={`crumb-${s.name}`}>
              <Icon name={ICONS[s.kind]} size={11} color={colors.brand} />
              <Text style={[styles.text, styles.file]} numberOfLines={1}>
                {s.name}
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  row: { alignItems: 'center', paddingHorizontal: spacing.sm, gap: 2, minHeight: 26 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  symbol: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.mutedForeground },
  file: { color: colors.foreground },
}));
