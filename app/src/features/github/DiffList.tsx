import { useMemo } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { PullFile, ReviewComment } from './api';
import { timeAgo } from './api';
import { commentTarget, DiffLine, parsePatch } from './diff';

type Item =
  | { kind: 'file'; key: string; file: PullFile }
  | { kind: 'line'; key: string; file: PullFile; line: DiffLine }
  | { kind: 'comment'; key: string; comment: ReviewComment }
  | { kind: 'note'; key: string; text: string };

const STATUS: Record<string, string> = { added: 'Added', removed: 'Deleted', renamed: 'Renamed', modified: 'Modified' };

// Changed files as one list: each file's lines with their numbers, and the
// review comments on them. With onLine, tapping a line starts a comment.
export function DiffList({
  files,
  comments = [],
  onLine,
  header,
}: {
  files: PullFile[];
  comments?: ReviewComment[];
  onLine?: (file: PullFile, target: { line: number; side: 'LEFT' | 'RIGHT' }, text: string) => void;
  header?: React.ReactElement;
}) {
  const styles = useStyles();
  const colors = useColors();
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const file of files) {
      out.push({ kind: 'file', key: `f:${file.filename}`, file });
      const lines = parsePatch(file.patch);
      if (!lines.length) out.push({ kind: 'note', key: `n:${file.filename}`, text: 'No text diff (binary or too large).' });
      for (const [i, line] of lines.entries()) {
        out.push({ kind: 'line', key: `l:${file.filename}:${i}`, file, line });
        const t = commentTarget(line);
        if (!t) continue;
        for (const c of comments) if (c.path === file.filename && c.line === t.line && c.side === t.side) out.push({ kind: 'comment', key: `c:${c.id}`, comment: c });
      }
    }
    return out;
  }, [files, comments]);

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.key}
      ListHeaderComponent={header}
      initialNumToRender={60}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => {
        if (item.kind === 'file')
          return (
            <View style={styles.file}>
              <Text variant="mono" style={styles.fileName} numberOfLines={2}>
                {item.file.filename}
              </Text>
              <Text variant="muted">
                {STATUS[item.file.status] ?? item.file.status} · <Text style={{ color: colors.success }}>+{item.file.additions}</Text>{' '}
                <Text style={{ color: colors.destructive }}>−{item.file.deletions}</Text>
              </Text>
            </View>
          );
        if (item.kind === 'note') return <Text variant="muted" style={styles.note}>{item.text}</Text>;
        if (item.kind === 'comment')
          return (
            <View style={styles.comment}>
              <Text variant="muted">
                <Text variant="label">{item.comment.user.login}</Text> · {timeAgo(item.comment.created_at)}
              </Text>
              <Text selectable>{item.comment.body}</Text>
            </View>
          );
        const { line, file } = item;
        const bg = line.kind === 'add' ? colors.successSoft : line.kind === 'del' ? colors.destructiveSoft : line.kind === 'hunk' ? colors.secondary : undefined;
        const target = commentTarget(line);
        const row = (
          <View style={[styles.line, bg ? { backgroundColor: bg } : null]}>
            <Text style={styles.num}>{line.old ?? ''}</Text>
            <Text style={styles.num}>{line.new ?? ''}</Text>
            <Text style={[styles.code, line.kind === 'hunk' && { color: colors.mutedForeground }]}>
              {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'hunk' ? '' : ' '}
              {line.text || ' '}
            </Text>
          </View>
        );
        return onLine && target ? (
          <Pressable onPress={() => onLine(file, target, line.text)} accessibilityRole="button" accessibilityLabel={`Comment on line ${target.line} of ${file.filename}`}>
            {row}
          </Pressable>
        ) : (
          row
        );
      }}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  list: { paddingBottom: spacing.xl },
  file: { gap: 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginTop: spacing.sm, backgroundColor: colors.card, borderTopWidth: borderWidth, borderBottomWidth: borderWidth, borderColor: colors.border },
  fileName: { fontFamily: fonts.mono.semibold },
  note: { padding: spacing.sm },
  line: { flexDirection: 'row' },
  num: { width: 38, paddingRight: 4, textAlign: 'right', fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.mutedForeground },
  code: { flex: 1, fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.foreground },
  comment: { marginHorizontal: spacing.sm, marginVertical: spacing.xs, padding: spacing.sm, gap: 2, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
}));
