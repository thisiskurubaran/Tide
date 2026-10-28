import Feather from '@expo/vector-icons/Feather';
import { useEffect, useRef, useState } from 'react';
import { Pressable, SectionList, TextInput, View } from 'react-native';

import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { SearchMatch, SearchResult, searchProject } from './search';

const DEBOUNCE_MS = 250;

interface SearchPanelProps {
  visible: boolean;
  project: string;
  onOpen(path: string, line: number): void;
  onClose(): void;
}

export function SearchPanel({ visible, project, onOpen, onClose }: SearchPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const run = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const id = ++run.current;
    const timer = setTimeout(() => {
      searchProject(workspace, project, query, { caseSensitive }).then((r) => {
        // Drop results from a query that has since changed.
        if (id === run.current) setResult(r);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, project, query, caseSensitive]);

  const sections = (result?.files ?? []).map((f) => ({ path: f.path, data: f.matches }));
  const summary = !query
    ? 'Type to search every file in the project'
    : !result
      ? 'Searching...'
      : result.total === 0
        ? 'No results'
        : `${result.total}${result.truncated ? '+' : ''} ${result.total === 1 ? 'result' : 'results'} in ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`;

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.inputRow}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          testID="search-input"
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="Search in project"
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.brand}
          returnKeyType="search"
          style={styles.input}
        />
        <Pressable
          testID="search-case"
          accessibilityRole="switch"
          accessibilityLabel="Match case"
          accessibilityState={{ checked: caseSensitive }}
          onPress={() => setCaseSensitive((c) => !c)}
          style={[styles.toggle, caseSensitive && styles.toggleOn]}
        >
          <Text variant="label" style={{ color: caseSensitive ? colors.foreground : colors.mutedForeground }}>
            Aa
          </Text>
        </Pressable>
      </View>
      <Text variant="muted" style={styles.summary}>
        {summary}
      </Text>
      <SectionList
        sections={sections}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(m, i) => `${m.line}:${i}`}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text variant="label" numberOfLines={1} style={styles.file}>
            {section.path}
          </Text>
        )}
        renderItem={({ item, section }) => (
          <Pressable
            testID={`search-hit-${section.path}:${item.line}`}
            onPress={() => {
              onClose();
              onOpen(section.path, item.line);
            }}
            style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
          >
            <Text variant="muted" style={styles.line}>
              {item.line}
            </Text>
            <Highlighted match={item} length={query.length} />
          </Pressable>
        )}
      />
    </Overlay>
  );
}

function Highlighted({ match, length }: { match: SearchMatch; length: number }) {
  const styles = useStyles();
  const { text, column } = match;
  return (
    <Text variant="mono" numberOfLines={1} style={styles.code}>
      {text.slice(0, column)}
      <Text variant="mono" style={styles.mark}>
        {text.slice(column, column + length)}
      </Text>
      {text.slice(column + length)}
    </Text>
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
  toggle: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  toggleOn: { backgroundColor: colors.secondary },
  summary: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  file: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  hit: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  pressed: { backgroundColor: colors.secondary },
  line: { minWidth: 28, textAlign: 'right', fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  code: { flex: 1, fontSize: fontSizes.xs },
  mark: { fontSize: fontSizes.xs, backgroundColor: colors.brandSoft, color: colors.foreground },
}));
