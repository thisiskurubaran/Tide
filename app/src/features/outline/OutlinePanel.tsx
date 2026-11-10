import { Icon } from '../../components/Icon';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { buffersStore } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, spacing } from '../../theme/tokens';
import { languageFor } from '../editor/bridge';
import { fuzzyFilter } from '../search/fuzzy';
import { CodeSymbol, SymbolKind, symbolsFor } from './symbols';

const ICON: Record<SymbolKind, 'box' | 'zap' | 'corner-down-right' | 'hash' | 'type' | 'align-left' | 'code' | 'grid' | 'layers'> = {
  class: 'box',
  function: 'zap',
  method: 'corner-down-right',
  variable: 'hash',
  type: 'type',
  heading: 'align-left',
  selector: 'code',
  table: 'grid',
  module: 'layers',
};

interface OutlinePanelProps {
  visible: boolean;
  project: string;
  path: string | null;
  onOpen(path: string, line: number): void;
  onClose(): void;
}

// The current file's functions, classes, headings and so on; type to filter
// (Go to Symbol), tap to jump. Free for everyone.
export function OutlinePanel({ visible, project, path, onOpen, onClose }: OutlinePanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState<CodeSymbol[] | null>(null);

  useEffect(() => {
    if (!visible || !path) return;
    setQuery('');
    buffersStore
      .getState()
      .load(project, path)
      .then(() => setSymbols(symbolsFor(buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '', languageFor(path))))
      .catch(() => setSymbols([]));
  }, [visible, project, path]);

  // Filtering flattens the tree into best matches first.
  const shown = useMemo(() => (symbols && query.trim() ? fuzzyFilter(symbols, query.trim(), (s) => s.name, 200) : (symbols ?? [])), [symbols, query]);

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.inputRow}>
        <Icon name="list" size={16} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={path ? `Go to a symbol in ${path.split('/').pop()}` : 'Open a file first'}
          placeholderTextColor={colors.mutedForeground}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          selectionColor={colors.brand}
          style={styles.input}
          onSubmitEditing={() => {
            if (!shown[0] || !path) return;
            onClose();
            onOpen(path, shown[0].line);
          }}
          testID="outline-filter"
        />
      </View>
      {symbols?.length === 0 && (
        <Text variant="muted" style={styles.pad}>
          {path ? 'No functions, classes or headings found in this file.' : 'Open a file to see its outline.'}
        </Text>
      )}
      <FlatList
        data={shown}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(s) => `${s.line}:${s.name}`}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.kind} ${item.name}, line ${item.line}`}
            onPress={() => {
              onClose();
              if (path) onOpen(path, item.line);
            }}
            style={({ pressed }) => [styles.row, { paddingLeft: spacing.md + (query.trim() ? 0 : item.depth * 16) }, pressed && styles.pressed]}
            testID={`symbol-${item.name}`}
          >
            <Icon name={ICON[item.kind]} size={14} color={item.kind === 'class' || item.kind === 'type' ? colors.warning : colors.brand} />
            <Text numberOfLines={1} style={styles.name}>
              {item.name}
            </Text>
            <Text variant="muted" style={styles.line}>
              {item.line}
            </Text>
          </Pressable>
        )}
      />
    </Overlay>
  );
}

const useStyles = makeStyles((colors) => ({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: borderWidth, borderColor: colors.border },
  input: { flex: 1, height: 48, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md },
  pad: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.md, paddingVertical: spacing.xs + 3 },
  pressed: { backgroundColor: colors.secondary },
  name: { flex: 1, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, color: colors.foreground },
  line: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
}));
