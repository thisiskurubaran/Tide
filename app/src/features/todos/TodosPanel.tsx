import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, SectionList, View } from 'react-native';

import { Overlay } from '../../components/Overlay';
import { Text } from '../../components/Text';
import { buffersStore, workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { findTodos, Todo, TodoTag } from './todos';

const TAGS: TodoTag[] = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'];

interface TodosPanelProps {
  visible: boolean;
  project: string;
  onOpen(path: string, line: number): void;
  onClose(): void;
}

// Every TODO and FIXME in the project's comments; tap one to go to it. Free for everyone.
export function TodosPanel({ visible, project, onOpen, onClose }: TodosPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [result, setResult] = useState<{ todos: Todo[]; truncated: boolean } | null>(null);
  const [tag, setTag] = useState<TodoTag | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setError(null);
    // Unsaved edits count too.
    buffersStore
      .getState()
      .flushProject(project)
      .then(() => findTodos(workspace, project))
      .then(setResult, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [visible, project]);

  const counts = useMemo(() => Object.fromEntries(TAGS.map((t) => [t, result?.todos.filter((x) => x.tag === t).length ?? 0])), [result]);
  const sections = useMemo(() => {
    const byFile = new Map<string, Todo[]>();
    for (const t of result?.todos ?? []) if (!tag || t.tag === tag) byFile.set(t.path, [...(byFile.get(t.path) ?? []), t]);
    return [...byFile].map(([path, data]) => ({ path, data }));
  }, [result, tag]);

  const tagColor = (t: TodoTag) => (t === 'FIXME' || t === 'BUG' ? colors.destructive : t === 'HACK' || t === 'XXX' ? colors.warning : colors.brand);

  return (
    <Overlay visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <Text variant="title">TODOs</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Pressable onPress={() => setTag(null)} accessibilityRole="button" accessibilityState={{ selected: !tag }} style={[styles.chip, !tag && styles.chipOn]}>
            <Text variant="label">All {result ? result.todos.length : ''}</Text>
          </Pressable>
          {TAGS.filter((t) => counts[t]).map((t) => (
            <Pressable key={t} onPress={() => setTag(t)} accessibilityRole="button" accessibilityState={{ selected: tag === t }} style={[styles.chip, tag === t && styles.chipOn]} testID={`todos-tag-${t}`}>
              <Text variant="label">
                {t} {counts[t]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {error && (
        <Text variant="error" style={styles.pad}>
          {error}
        </Text>
      )}
      {!result && !error && <ActivityIndicator style={styles.pad} color={colors.mutedForeground} />}
      {result?.todos.length === 0 && (
        <Text variant="muted" style={styles.pad}>
          No TODO, FIXME, HACK, XXX or BUG comments in this project.
        </Text>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(t) => `${t.path}:${t.line}`}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text variant="label" numberOfLines={1} style={styles.file}>
            {section.path}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.tag}: ${item.text || 'no text'}, line ${item.line}`}
            onPress={() => {
              onClose();
              onOpen(item.path, item.line);
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID={`todo-${item.path}:${item.line}`}
          >
            <Text variant="muted" style={styles.line}>
              {item.line}
            </Text>
            <Text style={[styles.tag, { color: tagColor(item.tag) }]}>{item.tag}</Text>
            <Text numberOfLines={2} style={styles.text}>
              {item.text || ' '}
            </Text>
          </Pressable>
        )}
        ListFooterComponent={result?.truncated ? <Text variant="muted" style={styles.pad}>Showing the first 1,000.</Text> : undefined}
      />
    </Overlay>
  );
}

const useStyles = makeStyles((colors) => ({
  head: { gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  chips: { gap: spacing.xs + 2 },
  chip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  pad: { padding: spacing.md },
  file: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  pressed: { backgroundColor: colors.secondary },
  line: { minWidth: 28, textAlign: 'right', fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  tag: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.xs },
  text: { flex: 1, fontSize: fontSizes.sm, color: colors.foreground },
}));
