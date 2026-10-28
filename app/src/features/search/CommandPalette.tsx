import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, spacing } from '../../theme/tokens';
import { basename, dirname } from '../files/fs';
import { fuzzyFilter } from './fuzzy';

export interface Command {
  id: string;
  title: string;
  icon: IconName;
  // Shown on the right, e.g. a keyboard shortcut.
  hint?: string;
  run(): void;
}

type Item = { kind: 'file'; path: string } | { kind: 'command'; command: Command };

interface CommandPaletteProps {
  // 'files' is quick open; typing ">" there switches to commands, like desktop editors.
  mode: 'files' | 'commands' | null;
  project: string;
  commands: Command[];
  onOpenFile(path: string): void;
  onClose(): void;
}

export function CommandPalette({ mode, project, commands, onOpenFile, onClose }: CommandPaletteProps) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);

  useEffect(() => {
    if (!mode) return;
    setQuery(mode === 'commands' ? '>' : '');
    workspace.listFiles(project).then(setFiles, () => setFiles([]));
  }, [mode, project]);

  const items = useMemo<Item[]>(() => {
    if (query.startsWith('>')) {
      return fuzzyFilter(commands, query.slice(1).trim(), (c) => c.title).map((command) => ({ kind: 'command', command }));
    }
    return fuzzyFilter(files, query.trim(), (p) => p).map((path) => ({ kind: 'file', path }));
  }, [query, files, commands]);

  function choose(item: Item) {
    onClose();
    if (item.kind === 'file') onOpenFile(item.path);
    else item.command.run();
  }

  return (
    <Overlay visible={mode !== null} onClose={onClose}>
      <View style={styles.inputRow}>
        <Feather name={query.startsWith('>') ? 'chevron-right' : 'search'} size={16} color={colors.mutedForeground} />
        <TextInput
          testID="palette-input"
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={query.startsWith('>') ? 'Run a command' : 'Open a file, or type > for commands'}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.brand}
          returnKeyType="go"
          onSubmitEditing={() => items[0] && choose(items[0])}
          style={styles.input}
        />
      </View>
      <FlatList
        data={items}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => (item.kind === 'file' ? `f:${item.path}` : `c:${item.command.id}`)}
        ListEmptyComponent={<Text variant="muted" style={styles.empty}>{query.startsWith('>') ? 'No matching commands' : 'No matching files'}</Text>}
        renderItem={({ item, index }) => (
          <Pressable
            testID={item.kind === 'file' ? `palette-file-${item.path}` : `palette-command-${item.command.id}`}
            onPress={() => choose(item)}
            style={({ pressed }) => [styles.row, (pressed || index === 0) && styles.rowActive]}
          >
            <Feather name={item.kind === 'file' ? 'file-text' : item.command.icon} size={16} color={colors.mutedForeground} />
            {item.kind === 'file' ? (
              <View style={styles.fileText}>
                <Text variant="label" numberOfLines={1}>
                  {basename(item.path)}
                </Text>
                {dirname(item.path) ? (
                  <Text variant="muted" numberOfLines={1} style={styles.dir}>
                    {dirname(item.path)}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text variant="label" numberOfLines={1} style={styles.fileText}>
                {item.command.title}
              </Text>
            )}
            {item.kind === 'command' && item.command.hint ? (
              <Text variant="muted" style={styles.hint}>
                {item.command.hint}
              </Text>
            ) : null}
          </Pressable>
        )}
      />
    </Overlay>
  );
}

const useStyles = makeStyles((colors) => ({
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  input: { flex: 1, height: 48, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2 },
  rowActive: { backgroundColor: colors.secondary },
  fileText: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  dir: { flexShrink: 1, fontSize: fontSizes.xs },
  hint: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  empty: { padding: spacing.md },
}));
