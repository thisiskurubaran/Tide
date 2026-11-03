import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, ScrollViewInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { FileBadge } from '../../components/FileBadge';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { Hunk, lineText } from '../../extensions/gitPro/diff';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { ChangeConflictError, changeHunks, countLines, FileChange } from './changes';
import { changesStore, setDraft, useAgentSession, useChanges } from './session';

// Runs a keep/reject; a file changed behind the agent's back asks before overwriting.
async function act(fn: (force: boolean) => Promise<void>) {
  try {
    await fn(false);
    haptic('success');
  } catch (e) {
    if (e instanceof ChangeConflictError) {
      Alert.alert(`${e.path} changed`, 'It was edited after the agent changed it. Overwrite it with the reviewed version?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Overwrite', style: 'destructive', onPress: () => fn(true).catch((err) => Alert.alert('Not saved', String(err instanceof Error ? err.message : err))) },
      ]);
    } else {
      haptic('error');
      Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
    }
  }
}

// Every pending change from the agent as a diff, kept or rejected per hunk,
// per file, or all at once.
export function ReviewScreen() {
  const { project = '' } = useLocalSearchParams<{ project: string }>();
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const byPath = useChanges((s) => s.byProject[project]);
  const session = useAgentSession(project);
  const changes = useMemo(() => Object.values(byPath ?? {}).sort((a, b) => a.path.localeCompare(b.path)), [byPath]);
  const stats = useMemo(() => new Map(changes.map((c) => [c.path, countLines(changeHunks(c))])), [changes]);
  const total = useMemo(() => [...stats.values()].reduce((t, s) => ({ added: t.added + s.added, removed: t.removed + s.removed }), { added: 0, removed: 0 }), [stats]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const offsets = useRef<Record<string, number>>({});

  const run = async (fn: (force: boolean) => Promise<void>) => {
    setBusy(true);
    await act(fn);
    setBusy(false);
  };
  const store = () => changesStore.getState();
  const test = session.lastTest;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="agent-review-screen">
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <View style={styles.fill}>
          <Text variant="title" numberOfLines={1}>
            Review changes
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {changes.length} {changes.length === 1 ? 'file' : 'files'} · +{total.added} −{total.removed}
          </Text>
        </View>
      </View>

      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.content}>
        {test && (
          <View style={styles.test} testID="agent-review-test">
            <Feather
              name={test.code === 0 ? 'check-circle' : 'x-circle'}
              size={15}
              color={test.code === 0 ? colors.success : test.code === null && !test.timedOut ? colors.mutedForeground : colors.destructive}
            />
            <Text variant="mono" style={styles.testCommand} numberOfLines={1}>
              {test.command}
            </Text>
            <Text variant="muted" style={styles.fill} numberOfLines={2}>
              {test.timedOut ? 'timed out' : test.code === 0 ? 'passed' : test.code === null ? 'ran' : `failed (exit ${test.code})`}
              {test.summary ? ` · ${test.summary}` : ''}
            </Text>
          </View>
        )}

        {changes.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="check" size={22} color={colors.success} />
            <Text variant="title">All changes reviewed</Text>
            <Button title="Back to the agent" variant="outline" onPress={() => router.back()} />
          </View>
        ) : (
          <View style={styles.fileList}>
            {changes.map((c) => {
              const s = stats.get(c.path)!;
              return (
                <Pressable
                  key={c.path}
                  accessibilityRole="button"
                  onPress={() => {
                    setCollapsed((m) => ({ ...m, [c.path]: false }));
                    scroll.current?.scrollTo({ y: offsets.current[c.path] ?? 0, animated: true });
                  }}
                  style={({ pressed }) => [styles.fileListRow, pressed && { backgroundColor: colors.secondary }]}
                >
                  <FileBadge name={c.path} />
                  <Text variant="mono" style={styles.fill} numberOfLines={1}>
                    {c.path}
                  </Text>
                  {c.original === null && <Text style={styles.newTag}>new</Text>}
                  <Counts added={s.added} removed={s.removed} />
                </Pressable>
              );
            })}
          </View>
        )}

        {changes.map((c) => (
          <View key={c.path} onLayout={(e) => (offsets.current[c.path] = e.nativeEvent.layout.y)}>
            <FileDiff
              change={c}
              stats={stats.get(c.path)!}
              open={!collapsed[c.path]}
              busy={busy}
              onToggle={() => setCollapsed((m) => ({ ...m, [c.path]: !m[c.path] }))}
              onKeepFile={() => run((f) => store().keepFile(project, c.path, f))}
              onRejectFile={() => run((f) => store().rejectFile(project, c.path, f))}
              onKeepHunk={(i) => run((f) => store().keepHunk(project, c.path, i, f))}
              onRejectHunk={(i) => run((f) => store().rejectHunk(project, c.path, i, f))}
            />
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button
          title="Undo all"
          variant="outline"
          disabled={busy || !changes.length}
          onPress={() =>
            Alert.alert('Undo all changes?', 'Every pending change from the agent is discarded.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Undo all', style: 'destructive', onPress: () => run((f) => store().undoAll(project, f)) },
            ])
          }
          testID="agent-undo-all"
        />
        <Button
          title="Ask for changes"
          variant="outline"
          disabled={busy}
          onPress={() => {
            setDraft(project, 'About your changes: ');
            router.back();
          }}
          testID="agent-ask-changes"
        />
        <View style={styles.fill} />
        <Button title="Keep all" icon="check" disabled={busy || !changes.length} onPress={() => run((f) => store().keepAll(project, f))} testID="agent-keep-all" />
      </View>
    </View>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Text style={styles.counts}>
      <Text style={[styles.counts, { color: colors.success }]}>+{added}</Text> <Text style={[styles.counts, { color: colors.destructive }]}>−{removed}</Text>
    </Text>
  );
}

interface FileDiffProps {
  change: FileChange;
  stats: { added: number; removed: number };
  open: boolean;
  busy: boolean;
  onToggle(): void;
  onKeepFile(): void;
  onRejectFile(): void;
  onKeepHunk(index: number): void;
  onRejectHunk(index: number): void;
}

function FileDiff({ change, stats, open, busy, onToggle, onKeepFile, onRejectFile, onKeepHunk, onRejectHunk }: FileDiffProps) {
  const styles = useStyles();
  const colors = useColors();
  const hunks = useMemo(() => changeHunks(change), [change]);
  return (
    <View style={styles.file} testID={`agent-file-${change.path}`}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={styles.fileHeader}>
        <Feather name={open ? 'chevron-down' : 'chevron-right'} size={16} color={colors.mutedForeground} />
        <FileBadge name={change.path} />
        <Text variant="mono" style={styles.fill} numberOfLines={1}>
          {change.path}
        </Text>
        <Counts added={stats.added} removed={stats.removed} />
      </Pressable>
      {open && (
        <>
          <View style={styles.fileActions}>
            <Text variant="muted" style={styles.fill}>
              {change.original === null ? 'New file' : `${hunks.length} ${hunks.length === 1 ? 'change' : 'changes'}`}
              {change.disk === change.proposed && change.original !== change.proposed ? ' · on disk for a command' : ''}
            </Text>
            <SmallButton label="Reject file" onPress={onRejectFile} disabled={busy} />
            <SmallButton label="Keep file" onPress={onKeepFile} disabled={busy} primary />
          </View>
          {hunks.map((h, i) => (
            <HunkView key={`${h.oldStart}-${h.newStart}-${i}`} hunk={h} index={i} busy={busy} onKeep={() => onKeepHunk(i)} onReject={() => onRejectHunk(i)} />
          ))}
        </>
      )}
    </View>
  );
}

function SmallButton({ label, onPress, disabled, primary }: { label: string; onPress(): void; disabled?: boolean; primary?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.small, primary && styles.smallPrimary, (pressed || disabled) && { opacity: 0.6 }]}
      testID={`agent-${label.toLowerCase().replace(/\W+/g, '-')}`}
    >
      <Text style={[styles.smallText, primary && styles.smallPrimaryText]}>{label}</Text>
    </Pressable>
  );
}

function HunkView({ hunk, index, busy, onKeep, onReject }: { hunk: Hunk; index: number; busy: boolean; onKeep(): void; onReject(): void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.hunk} testID={`agent-hunk-${index}`}>
      <View style={styles.hunkHeader}>
        <Text variant="mono" style={styles.range}>
          @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </Text>
        <SmallButton label="Reject" onPress={onReject} disabled={busy} />
        <SmallButton label="Keep" onPress={onKeep} disabled={busy} primary />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {hunk.lines.map((l, j) => {
            const bg = l.kind === 'add' ? colors.successSoft : l.kind === 'del' ? colors.destructiveSoft : undefined;
            return (
              <View key={j} style={[styles.line, bg ? { backgroundColor: bg } : null]}>
                <Text variant="mono" style={styles.number}>
                  {l.oldLine ?? ''}
                </Text>
                <Text variant="mono" style={styles.number}>
                  {l.newLine ?? ''}
                </Text>
                <Text variant="mono" style={[styles.sign, { color: l.kind === 'add' ? colors.success : l.kind === 'del' ? colors.destructive : colors.mutedForeground }]}>
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
                </Text>
                <Text
                  variant="mono"
                  style={[
                    styles.code,
                    l.kind === 'same' && { color: colors.mutedForeground },
                    l.kind === 'del' && { textDecorationLine: 'line-through', textDecorationColor: colors.destructive, color: colors.foreground },
                  ]}
                >
                  {lineText(l.text) || ' '}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: borderWidth, borderBottomColor: colors.border },
  content: { padding: spacing.md, gap: spacing.md },
  test: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.card, borderWidth, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm + 2 },
  testCommand: { maxWidth: '45%' },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  fileList: { backgroundColor: colors.card, borderWidth, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  fileListRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.sm },
  newTag: { color: colors.brand, fontFamily: fonts.sans.medium, fontSize: fontSizes.xs },
  counts: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.mutedForeground },
  file: { backgroundColor: colors.card, borderWidth, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2 },
  fileActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingBottom: spacing.sm },
  hunk: { borderTopWidth: borderWidth, borderTopColor: colors.border },
  hunkHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 2, backgroundColor: colors.secondary },
  range: { flex: 1, color: colors.mutedForeground, fontSize: fontSizes.xs },
  line: { flexDirection: 'row' },
  number: { width: 34, textAlign: 'right', paddingRight: spacing.xs, color: colors.mutedForeground, fontSize: fontSizes.xs, lineHeight: 20 },
  sign: { width: 14, textAlign: 'center', fontSize: 13, lineHeight: 20 },
  code: { fontFamily: fonts.mono.regular, fontSize: 13, lineHeight: 20, paddingRight: spacing.md },
  small: { borderWidth, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm + 2, paddingVertical: 4, backgroundColor: colors.card },
  smallPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  smallText: { color: colors.foreground, fontFamily: fonts.sans.medium, fontSize: fontSizes.xs },
  smallPrimaryText: { color: colors.brandForeground },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, borderTopWidth: borderWidth, borderTopColor: colors.border, backgroundColor: colors.card },
}));
