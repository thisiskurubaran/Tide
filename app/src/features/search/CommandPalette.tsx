import { Icon } from '../../components/Icon';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text as RNText, StyleProp, TextInput, TextInputInstance, TextInputKeyPressEvent, TextStyle, View } from 'react-native';

import type { IconName } from '../../components/Button';
import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { languageFor } from '../editor/bridge';
import { basename, dirname } from '../files/fs';
import { CodeSymbol, SymbolKind, symbolsFor } from '../outline/symbols';
import { fuzzyFilter, fuzzyPositions } from './fuzzy';
import { highlightSegments, initialInput, PaletteKind, parsePaletteQuery, pushRecent, range, withPrefix } from './paletteQuery';
import { searchProject } from './search';

export interface Command {
  id: string;
  title: string;
  icon: IconName;
  // Shown on the right, e.g. a keyboard shortcut.
  hint?: string;
  run(): void;
}

export interface CommandPaletteProps {
  // The prefix the input opens with: 'files' is quick open (no prefix),
  // 'commands' pre-fills ">", and so on. null hides the palette.
  mode: PaletteKind | null;
  project: string;
  commands: Command[];
  onOpenFile(path: string): void;
  onClose(): void;
  // The file in the editor, for "@" (symbols) and ":" (go to line).
  activePath?: string | null;
  // Opens a file at a position, for "@", ":" and "#". Without it those open the file only.
  onOpenAt?(path: string, line: number, column?: number): void;
}

type Row =
  | { kind: 'header'; title: string }
  | { kind: 'file'; path: string; positions: number[] | null }
  | { kind: 'command'; command: Command; positions: number[] | null }
  | { kind: 'symbol'; symbol: CodeSymbol; positions: number[] | null }
  | { kind: 'line'; line: number; column?: number }
  | { kind: 'match'; path: string; line: number; text: string; column: number; length: number };

type Selectable = Exclude<Row, { kind: 'header' }>;

const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 28;
const TEXT_DEBOUNCE_MS = 200;
const TEXT_LIMIT = 50;

const CHIPS: { kind: PaletteKind; prefix: string; label: string }[] = [
  { kind: 'files', prefix: '', label: 'Files' },
  { kind: 'commands', prefix: '>', label: 'Commands' },
  { kind: 'symbols', prefix: '@', label: 'Symbols' },
  { kind: 'line', prefix: ':', label: 'Line' },
  { kind: 'text', prefix: '#', label: 'Text' },
];

const INPUT_ICON: Record<PaletteKind, IconName> = {
  files: 'search',
  commands: 'chevron-right',
  symbols: 'at-sign',
  line: 'corner-down-right',
  text: 'type',
};

const PLACEHOLDER: Record<PaletteKind, string> = {
  files: 'Open a file, or type > for commands',
  commands: 'Run a command',
  symbols: 'Go to a symbol in this file',
  line: 'Go to line, like 42 or 42:7',
  text: 'Search text in every file',
};

// Same icons as the outline panel, so a symbol looks the same in both.
const SYMBOL_ICON: Record<SymbolKind, IconName> = {
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

// Recently run command ids, newest first. In memory: it only has to survive
// reopening the palette, not an app restart.
let recentCommands: string[] = [];

const isHeader = (row: Row): row is { kind: 'header'; title: string } => row.kind === 'header';

export function CommandPalette({ mode, project, commands, onOpenFile, onClose, activePath, onOpenAt }: CommandPaletteProps) {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<{ path: string; list: CodeSymbol[] } | null>(null);
  const [matches, setMatches] = useState<{ query: string; rows: Row[] } | null>(null);
  const searchRun = useRef(0);
  const input = useRef<TextInputInstance>(null);
  const list = useRef<FlatList<Row>>(null);
  const visible = mode !== null;
  const parsed = parsePaletteQuery(query);
  const path = activePath ?? null;

  useEffect(() => {
    if (!mode) return;
    setQuery(initialInput(mode));
    setSelected(0);
    workspace.listFiles(project).then(setFiles, () => setFiles([]));
  }, [mode, project]);

  // Symbols come from the buffer, so unsaved edits show up.
  const wantSymbols = visible && parsed.kind === 'symbols' && path !== null;
  useEffect(() => {
    if (!wantSymbols || !path) return;
    let live = true;
    buffersStore
      .getState()
      .load(project, path)
      .then(() => buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '')
      .then(
        (content) => live && setSymbols({ path, list: symbolsFor(content, languageFor(path)) }),
        () => live && setSymbols({ path, list: [] }),
      );
    return () => {
      live = false;
    };
  }, [wantSymbols, project, path]);

  // Text search reads every file, so it waits for a pause in typing.
  const textQuery = visible && parsed.kind === 'text' ? parsed.text : '';
  useEffect(() => {
    const id = ++searchRun.current;
    if (!textQuery) {
      setMatches(null);
      return;
    }
    const timer = setTimeout(() => {
      buffersStore
        .getState()
        // Unsaved edits count, like the search panel.
        .flushProject(project)
        .then(() => searchProject(workspace, project, textQuery, { limit: TEXT_LIMIT }))
        .then(
          (r) => {
            if (id !== searchRun.current) return;
            const rows: Row[] = r.files.flatMap((f) => f.matches.map((m) => ({ kind: 'match' as const, path: f.path, ...m })));
            setMatches({ query: textQuery, rows: rows.slice(0, TEXT_LIMIT) });
          },
          () => id === searchRun.current && setMatches({ query: textQuery, rows: [] }),
        );
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [textQuery, project]);

  const { rows, empty } = useMemo((): { rows: Row[]; empty: string } => {
    const text = parsed.kind === 'line' ? '' : parsed.text;
    switch (parsed.kind) {
      case 'commands': {
        const header: Row = { kind: 'header', title: 'COMMANDS' };
        if (!text) {
          // Just ">": recently run commands first, then the rest in their usual order.
          const recent = recentCommands.map((id) => commands.find((c) => c.id === id)).filter((c): c is Command => !!c);
          const rest = commands.filter((c) => !recent.includes(c));
          const toRow = (command: Command): Row => ({ kind: 'command', command, positions: null });
          const out: Row[] = recent.length ? [{ kind: 'header', title: 'RECENT' }, ...recent.map(toRow)] : [];
          if (rest.length) out.push(header, ...rest.map(toRow));
          return { rows: out, empty: 'No matching commands' };
        }
        const found = fuzzyFilter(commands, text, (c) => c.title);
        const out: Row[] = found.map((command) => ({ kind: 'command', command, positions: fuzzyPositions(text, command.title) }));
        return { rows: out.length ? [header, ...out] : [], empty: 'No matching commands' };
      }
      case 'symbols': {
        if (!path) return { rows: [], empty: 'Open a file first' };
        if (!symbols || symbols.path !== path) return { rows: [], empty: 'Reading symbols...' };
        if (symbols.list.length === 0) return { rows: [], empty: 'No functions, classes or headings in this file' };
        const found = text ? fuzzyFilter(symbols.list, text, (s) => s.name, 200) : symbols.list;
        return { rows: found.map((symbol) => ({ kind: 'symbol', symbol, positions: text ? fuzzyPositions(text, symbol.name) : null })), empty: 'No matching symbols' };
      }
      case 'line':
        if (!path) return { rows: [], empty: 'Open a file first' };
        if (parsed.line === null) return { rows: [], empty: 'Type a line number, like :42 or :42:7' };
        return { rows: [{ kind: 'line', line: parsed.line, column: parsed.column }], empty: '' };
      case 'text':
        if (!text) return { rows: [], empty: 'Type to search text in every file' };
        // Older results stay up while the next search runs, so the list doesn't flicker.
        if (!matches) return { rows: [], empty: 'Searching...' };
        return { rows: matches.rows, empty: matches.query === text ? 'No matches' : 'Searching...' };
      default:
        return {
          rows: fuzzyFilter(files, text, (p) => p).map((p) => ({ kind: 'file', path: p, positions: text ? fuzzyPositions(text, p) : null })),
          empty: 'No matching files',
        };
    }
    // parsed is rebuilt every render from query; its parts are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, files, commands, path, symbols, matches]);

  // Headers sit in the list but can't be selected; selection counts the rest.
  const selectable = useMemo(() => rows.filter((r): r is Selectable => !isHeader(r)), [rows]);
  const current = selectable.length ? Math.min(selected, selectable.length - 1) : -1;
  const currentRow = current >= 0 ? selectable[current] : null;

  // Offsets for getItemLayout, so arrow keys can scroll the selection into view.
  const offsets = useMemo(() => {
    const out: number[] = [];
    let y = 0;
    for (const r of rows) {
      out.push(y);
      y += isHeader(r) ? HEADER_HEIGHT : ROW_HEIGHT;
    }
    return out;
  }, [rows]);

  function changeQuery(next: string) {
    setQuery(next);
    setSelected(0);
  }

  function openAt(file: string, line: number, column?: number) {
    if (onOpenAt) onOpenAt(file, line, column);
    else onOpenFile(file);
  }

  function choose(row: Selectable) {
    onClose();
    switch (row.kind) {
      case 'file':
        onOpenFile(row.path);
        break;
      case 'command':
        recentCommands = pushRecent(recentCommands, row.command.id);
        row.command.run();
        break;
      case 'symbol':
        if (path) openAt(path, row.symbol.line);
        break;
      case 'line':
        if (path) openAt(path, row.line, row.column);
        break;
      case 'match':
        // The match column is into a trimmed excerpt, not the line, so only the line is exact.
        openAt(row.path, row.line);
        break;
    }
  }

  function move(by: number) {
    if (!selectable.length) return;
    const next = (current + by + selectable.length) % selectable.length;
    setSelected(next);
    const index = rows.indexOf(selectable[next]);
    try {
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    } catch {
      // Not laid out yet; the selection still moves.
    }
  }

  // Hardware keyboards: arrows move the selection. RN reports arrow keys on
  // web (and iPad with some keyboards); elsewhere this is never called.
  function onKeyPress(e: TextInputKeyPressEvent) {
    const key = e.nativeEvent.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault?.();
      move(key === 'ArrowDown' ? 1 : -1);
    } else if (key === 'Escape') onClose();
  }

  function highlighted(text: string, positions: readonly number[] | null | undefined, style?: StyleProp<TextStyle>, mono = false) {
    return (
      <Text variant={mono ? 'mono' : 'label'} numberOfLines={1} style={style}>
        {highlightSegments(text, positions).map((s, i) =>
          // Plain spans inherit the row's font and size; only the colour changes.
          s.hit ? (
            <RNText key={i} style={styles.hit}>
              {s.text}
            </RNText>
          ) : (
            s.text
          ),
        )}
      </Text>
    );
  }

  function renderRow(row: Row, active: boolean) {
    if (isHeader(row)) {
      return (
        <Text variant="muted" style={styles.header} accessibilityRole="header">
          {row.title}
        </Text>
      );
    }
    let icon: IconName;
    let testID: string;
    let label: string;
    let body: ReactNode;
    let hint: string | undefined;
    switch (row.kind) {
      case 'file': {
        const name = basename(row.path);
        const dir = dirname(row.path);
        const nameStart = row.path.length - name.length;
        icon = 'file-text';
        testID = `palette-file-${row.path}`;
        label = row.path;
        body = (
          <View style={styles.title}>
            {highlighted(name, row.positions?.filter((p) => p >= nameStart).map((p) => p - nameStart), styles.shrink)}
            {dir ? highlighted(dir, row.positions?.filter((p) => p < dir.length), [styles.dir, styles.muted]) : null}
          </View>
        );
        break;
      }
      case 'command':
        icon = row.command.icon;
        testID = `palette-command-${row.command.id}`;
        label = row.command.title;
        body = highlighted(row.command.title, row.positions, styles.flex);
        hint = row.command.hint;
        break;
      case 'symbol':
        icon = SYMBOL_ICON[row.symbol.kind];
        testID = `palette-symbol-${row.symbol.name}`;
        label = `${row.symbol.kind} ${row.symbol.name}, line ${row.symbol.line}`;
        body = highlighted(row.symbol.name, row.positions, styles.flex, true);
        hint = String(row.symbol.line);
        break;
      case 'line':
        icon = 'corner-down-right';
        testID = 'palette-goto-line';
        label = row.column ? `Go to line ${row.line}, column ${row.column}` : `Go to line ${row.line}`;
        body = (
          <Text variant="label" numberOfLines={1} style={styles.flex}>
            {label}
          </Text>
        );
        break;
      case 'match':
        icon = 'search';
        testID = `palette-match-${row.path}:${row.line}`;
        label = `${row.path} line ${row.line}: ${row.text}`;
        body = (
          <View style={styles.title}>
            <Text variant="mono" numberOfLines={1} style={[styles.location, styles.muted]}>
              {`${row.path}:${row.line}`}
            </Text>
            {highlighted(row.text, range(row.column, row.length), styles.shrink, true)}
          </View>
        );
        break;
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        testID={testID}
        onPress={() => choose(row)}
        style={({ pressed }) => [styles.row, (pressed || active) && styles.rowActive]}
      >
        <Icon name={icon} size={16} color={row.kind === 'symbol' ? colors.brand : colors.mutedForeground} />
        {body}
        {hint ? (
          <Text variant="muted" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </Pressable>
    );
  }

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.inputRow}>
        <Icon name={INPUT_ICON[parsed.kind]} size={16} color={colors.mutedForeground} />
        <TextInput
          ref={input}
          testID="palette-input"
          value={query}
          onChangeText={changeQuery}
          onKeyPress={onKeyPress}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={PLACEHOLDER[parsed.kind]}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.brand}
          returnKeyType="go"
          onSubmitEditing={() => currentRow && choose(currentRow)}
          style={styles.input}
        />
      </View>
      <View style={styles.chips}>
        {CHIPS.map((chip) => {
          const on = chip.kind === parsed.kind;
          return (
            <Pressable
              key={chip.kind}
              accessibilityRole="button"
              accessibilityLabel={`Search ${chip.label.toLowerCase()}`}
              accessibilityState={{ selected: on }}
              testID={`palette-prefix-${chip.kind}`}
              hitSlop={spacing.xs}
              onPress={() => {
                changeQuery(withPrefix(query, chip.kind));
                input.current?.focus();
              }}
              style={[styles.chip, on && styles.chipOn]}
            >
              {chip.prefix ? <Text style={[styles.chipPrefix, on && styles.chipTextOn]}>{chip.prefix}</Text> : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{chip.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <FlatList
        ref={list}
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row, i) => {
          switch (row.kind) {
            case 'header':
              return `h:${row.title}`;
            case 'file':
              return `f:${row.path}`;
            case 'command':
              return `c:${row.command.id}`;
            case 'symbol':
              return `s:${row.symbol.line}:${row.symbol.name}`;
            case 'line':
              return 'l';
            case 'match':
              return `m:${row.path}:${row.line}:${i}`;
          }
        }}
        getItemLayout={(_, index) => ({ length: isHeader(rows[index]) ? HEADER_HEIGHT : ROW_HEIGHT, offset: offsets[index] ?? 0, index })}
        ListEmptyComponent={
          empty ? (
            <Text variant="muted" style={styles.empty} testID="palette-empty">
              {empty}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => renderRow(item, item === currentRow)}
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
  },
  input: { flex: 1, height: 48, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  chipPrefix: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.mutedForeground },
  chipText: { fontFamily: fonts.sans.medium, fontSize: fontSizes.xs, color: colors.mutedForeground },
  chipTextOn: { color: colors.brand },
  header: {
    height: HEADER_HEIGHT,
    lineHeight: HEADER_HEIGHT,
    paddingHorizontal: spacing.md,
    fontFamily: fonts.sans.medium,
    fontSize: fontSizes.xs,
    letterSpacing: 0.8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: ROW_HEIGHT, paddingHorizontal: spacing.md },
  rowActive: { backgroundColor: colors.secondary },
  title: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, minWidth: 0 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  muted: { color: colors.mutedForeground },
  hit: { color: colors.brand },
  dir: { flexShrink: 1, fontFamily: fonts.sans.regular, fontSize: fontSizes.xs },
  location: { flexShrink: 0, maxWidth: '45%', fontSize: fontSizes.xs },
  hint: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  empty: { padding: spacing.md },
}));
