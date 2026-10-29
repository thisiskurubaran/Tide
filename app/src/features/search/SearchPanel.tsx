import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, SectionList, TextInput, View } from 'react-native';

import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { FileReplacement, planReplace, SearchMatch, SearchOptions, SearchResult, searchProject } from './search';
import { haptic } from '../../components/haptics';

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
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [include, setInclude] = useState('');
  const [exclude, setExclude] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  const options: SearchOptions = { caseSensitive, wholeWord, regex, include, exclude };
  const optionsKey = JSON.stringify(options);

  const search = useCallback(() => {
    const id = ++run.current;
    // Unsaved edits count: search what the editor shows.
    return buffersStore
      .getState()
      .flushProject(project)
      .then(() => searchProject(workspace, project, query, JSON.parse(optionsKey)))
      .then(
        (r) => {
          // Drop results from a query that has since changed.
          if (id !== run.current) return;
          setResult(r);
          setError(null);
        },
        (e: Error) => {
          if (id !== run.current) return;
          setResult(null);
          setError(e.message);
        },
      );
  }, [project, query, optionsKey]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(search, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, search]);

  // Writes planned replacements: open files through their buffers, so the editor shows the change.
  async function apply(changes: FileReplacement[]) {
    for (const c of changes) {
      if (buffersStore.getState().buffers[bufferKey(project, c.path)]) await buffersStore.getState().replace(project, c.path, c.after);
      else await workspace.writeFile(project, c.path, c.after);
    }
  }

  async function replace(only?: string[]) {
    setBusy(true);
    try {
      await buffersStore.getState().flushProject(project);
      const changes = await planReplace(workspace, project, query, replacement, options, only);
      const count = changes.reduce((n, c) => n + c.count, 0);
      if (!count) return;
      const go = () =>
        apply(changes)
          .then(() => haptic('success'))
          .then(search);
      if (only) await go();
      else {
        await new Promise<void>((resolve) =>
          Alert.alert(`Replace ${count} ${count === 1 ? 'match' : 'matches'}?`, `In ${changes.length} ${changes.length === 1 ? 'file' : 'files'}. You can undo it in each open file.`, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
            { text: 'Replace all', style: 'destructive', onPress: () => void go().finally(resolve) },
          ]),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sections = (result?.files ?? []).map((f) => ({ path: f.path, data: f.matches }));
  const summary = error
    ? error
    : !query
    ? 'Type to search every file in the project'
    : !result
      ? 'Searching...'
      : result.total === 0
        ? 'No results'
        : `${result.total}${result.truncated ? '+' : ''} ${result.total === 1 ? 'result' : 'results'} in ${result.files.length} ${result.files.length === 1 ? 'file' : 'files'}`;

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.inputRow}>
        <Pressable
          testID="search-toggle-replace"
          accessibilityRole="button"
          accessibilityLabel={replacing ? 'Hide replace' : 'Show replace'}
          onPress={() => setReplacing((r) => !r)}
          hitSlop={spacing.sm}
        >
          <Feather name={replacing ? 'chevron-down' : 'chevron-right'} size={16} color={colors.mutedForeground} />
        </Pressable>
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
        <Toggle testID="search-case" label="Match case" text="Aa" on={caseSensitive} onChange={setCaseSensitive} />
        <Toggle testID="search-word" label="Match whole word" text="ab|" on={wholeWord} onChange={setWholeWord} />
        <Toggle testID="search-regex" label="Use regular expression" text=".*" on={regex} onChange={setRegex} />
        <Pressable testID="search-filters" accessibilityLabel="Files to include or exclude" onPress={() => setFiltering((f) => !f)} hitSlop={spacing.xs}>
          <Feather name="filter" size={16} color={filtering || include || exclude ? colors.brand : colors.mutedForeground} />
        </Pressable>
      </View>
      {replacing && (
        <View style={styles.inputRow}>
          <Feather name="repeat" size={16} color={colors.mutedForeground} />
          <TextInput
            testID="replace-input"
            value={replacement}
            onChangeText={setReplacement}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder={regex ? 'Replace ($1 for groups)' : 'Replace'}
            placeholderTextColor={colors.mutedForeground}
            selectionColor={colors.brand}
            style={styles.input}
          />
          <Pressable
            testID="replace-all"
            accessibilityRole="button"
            accessibilityLabel="Replace all"
            disabled={busy || !result?.total}
            onPress={() => replace()}
            style={[styles.toggle, (busy || !result?.total) && styles.dimmed]}
          >
            <Text variant="label">All</Text>
          </Pressable>
        </View>
      )}
      {filtering && (
        <View style={styles.filters}>
          <TextInput
            testID="search-include"
            value={include}
            onChangeText={setInclude}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Files to include, e.g. src/**, *.ts"
            placeholderTextColor={colors.mutedForeground}
            style={styles.filter}
          />
          <TextInput
            testID="search-exclude"
            value={exclude}
            onChangeText={setExclude}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Files to exclude, e.g. *.test.js, dist"
            placeholderTextColor={colors.mutedForeground}
            style={styles.filter}
          />
        </View>
      )}
      <Text variant="muted" style={styles.summary}>
        {summary}
      </Text>
      <SectionList
        sections={sections}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(m, i) => `${m.line}:${i}`}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.fileRow}>
            <Text variant="label" numberOfLines={1} style={styles.file}>
              {section.path}
            </Text>
            {replacing && (
              <Pressable
                testID={`replace-file-${section.path}`}
                accessibilityLabel={`Replace in ${section.path}`}
                onPress={() => replace([section.path])}
                disabled={busy}
                hitSlop={spacing.xs}
              >
                <Feather name="repeat" size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
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
            <Highlighted match={item} />
          </Pressable>
        )}
      />
    </Overlay>
  );
}

function Toggle({ testID, label, text, on, onChange }: { testID: string; label: string; text: string; on: boolean; onChange(v: boolean): void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={[styles.toggle, on && styles.toggleOn]}
    >
      <Text variant="label" style={{ color: on ? colors.foreground : colors.mutedForeground }}>
        {text}
      </Text>
    </Pressable>
  );
}

function Highlighted({ match }: { match: SearchMatch }) {
  const styles = useStyles();
  const { text, column, length } = match;
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
  dimmed: { opacity: 0.4 },
  filters: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  filter: { height: 36, color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  fileRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.md },
  summary: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  file: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  hit: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  pressed: { backgroundColor: colors.secondary },
  line: { minWidth: 28, textAlign: 'right', fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  code: { flex: 1, fontSize: fontSizes.xs },
  mark: { fontSize: fontSizes.xs, backgroundColor: colors.brandSoft, color: colors.foreground },
}));
