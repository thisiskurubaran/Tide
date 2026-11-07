import Feather from '@expo/vector-icons/Feather';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useStore } from 'zustand';

import { Text } from '../../components/Text';
import { lineStarts, positionAt, useDiagnostics } from '../../extensions/diagnostics';
import { useBuffers, useRunner } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts } from '../../theme/tokens';
import { Language, languageFor } from '../editor/bridge';
import { LARGE_CHARS } from '../editor/largeFiles';
import { useGitStatus } from '../git/status';
import { cursorStore } from '../outline/Breadcrumbs';

const LANGUAGE_NAMES: Record<Language, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  python: 'Python',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  markdown: 'Markdown',
  lua: 'Lua',
  ruby: 'Ruby',
  php: 'PHP',
  sql: 'SQL',
  yaml: 'YAML',
  toml: 'TOML',
  dockerfile: 'Dockerfile',
  ini: 'INI',
  env: 'Env',
  shell: 'Shell',
  powershell: 'PowerShell',
  makefile: 'Makefile',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  objectivec: 'Objective-C',
  csharp: 'C#',
  kotlin: 'Kotlin',
  swift: 'Swift',
  dart: 'Dart',
  xml: 'XML',
  plain: 'Plain text',
};

// Errors and warnings across the project, from every source.
export function countProblems(byPath: Record<string, Record<string, { severity: string }[]>> | undefined) {
  let errors = 0;
  let warnings = 0;
  for (const sources of Object.values(byPath ?? {}))
    for (const list of Object.values(sources))
      for (const d of list) {
        if (d.severity === 'error') errors++;
        else if (d.severity === 'warning') warnings++;
      }
  return { errors, warnings };
}

interface StatusBarProps {
  project: string;
  path: string | null;
  running: boolean;
  onBranch(): void;
  onProblems(): void;
  onGoToLine(): void;
  onMode(): void;
}

// The thin bar along the bottom of a desktop IDE: branch, problems, cursor
// position, language and where code runs. Each item opens what it describes.
export function StatusBar({ project, path, running, onBranch, onProblems, onGoToLine, onMode }: StatusBarProps) {
  const styles = useStyles();
  const colors = useColors();
  const git = useGitStatus((s) => s.byProject[project]);
  const changed = git ? Object.keys(git.changes).length : 0;
  const counts = useDiagnostics((s) => s.byProject[project]);
  const { errors, warnings } = useMemo(() => countProblems(counts), [counts]);
  const mode = useRunner((s) => s.mode);
  const content = useBuffers((s) => (path ? s.buffers[bufferKey(project, path)]?.content : undefined));
  const offset = useStore(cursorStore, (s) => (s.path === path ? s.offset : 0));
  const position = useMemo(
    () => (content !== undefined && content.length <= LARGE_CHARS ? positionAt(lineStarts(content), offset) : null),
    [content, offset],
  );

  const item = (label: string, onPress: () => void, children: React.ReactNode, testID: string) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={{ top: 10, bottom: 10 }} style={({ pressed }) => [styles.item, pressed && styles.pressed]} testID={testID}>
      {children}
    </Pressable>
  );

  return (
    <View style={styles.bar} testID="status-bar">
      {git?.branch &&
        item(
          `Branch ${git.branch}, ${changed} changed`,
          onBranch,
          <>
            <Feather name="git-branch" size={11} color={colors.mutedForeground} />
            <Text style={styles.text} numberOfLines={1}>
              {git.branch}
              {changed > 0 ? ` · ${changed}` : ''}
            </Text>
          </>,
          'status-branch',
        )}
      {item(
        `${errors} errors, ${warnings} warnings`,
        onProblems,
        <>
          <Feather name="x-circle" size={11} color={errors ? colors.destructive : colors.mutedForeground} />
          <Text style={[styles.text, errors > 0 && { color: colors.destructive }]}>{errors}</Text>
          <Feather name="alert-triangle" size={11} color={warnings ? colors.warning : colors.mutedForeground} />
          <Text style={[styles.text, warnings > 0 && { color: colors.warning }]}>{warnings}</Text>
        </>,
        'status-problems',
      )}
      <View style={styles.spacer} />
      {running && (
        <View style={styles.item} accessibilityLiveRegion="polite" accessibilityLabel="Running">
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.text, { color: colors.success }]}>Running</Text>
        </View>
      )}
      {path && position && item(`Line ${position.line}, column ${position.column}. Go to line`, onGoToLine, <Text style={styles.text}>{`Ln ${position.line}, Col ${position.column}`}</Text>, 'status-position')}
      {path && (
        <View style={styles.item}>
          <Text style={styles.text}>{LANGUAGE_NAMES[languageFor(path)]}</Text>
        </View>
      )}
      {item(
        `Runs on ${mode === 'local' ? 'this device' : 'Remote'}`,
        onMode,
        <>
          <Feather name={mode === 'local' ? 'smartphone' : 'server'} size={11} color={colors.brand} />
          <Text style={[styles.text, { color: colors.brand }]}>{mode === 'local' ? 'Local' : 'Remote'}</Text>
        </>,
        'status-mode',
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 24,
    paddingHorizontal: 6,
    borderTopWidth: borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 6, borderRadius: 4 },
  pressed: { backgroundColor: colors.secondary },
  text: { fontFamily: fonts.sans.regular, fontSize: 11, color: colors.mutedForeground },
  spacer: { flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
}));
