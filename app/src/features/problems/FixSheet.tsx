// "✦ Suggested fix": asks the chat model to fix a problem (or a file's
// problems, or a failed run), shows the explanation and a diff per file, and
// applies the edits through the open buffers so the editor updates and ⌘Z
// undoes them.
import { useStore } from 'zustand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { diagnosticsStore, fileDiagnostics } from '../../extensions/diagnostics';
import { diffText, Hunk, lineText } from '../../extensions/gitPro/diff';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { AiError, aiReady } from '../ai/client';
import { ContextSource, FileChange, FixMode, FixRequest, FixResult, formatTokens, gatherContext, requestFix } from '../ai/fix';
import { DEFAULT_JOBS, modelLabel } from '../ai/providers/catalog';
import { AiSetupSheet } from '../ai/AiSetupSheet';
import { aiSettings } from '../ai/settings';
import { costOf } from '../ai/usage';
import type { ModelRef, Usage } from '../ai/providers/types';

export type { FixRequest } from '../ai/fix';

export interface FixSheetProps {
  project: string;
  // What to fix; null closes the sheet.
  request: FixRequest | null;
  onClose(): void;
}

// The model the chat job uses, for the chip.
const chatModelOf = (s: object): ModelRef => {
  const chat = (s as { jobs?: { chat?: ModelRef } }).jobs?.chat;
  return chat && typeof chat.model === 'string' ? chat : DEFAULT_JOBS.chat;
};

export function costLine(usage: Usage, model: ModelRef): string {
  const tokens = formatTokens(usage);
  // Null when Tide doesn't know the model's price: tokens only then.
  const cost = costOf(model.provider, model.model, usage);
  const dollars = cost === null || !Number.isFinite(cost) ? '' : cost < 0.005 ? ' · under $0.01' : ` · about $${cost.toFixed(2)}`;
  return `${tokens}${dollars} · undo with ⌘Z or Local history`;
}

type State =
  | { status: 'idle' }
  | { status: 'loading'; mode: FixMode; result: FixResult | null }
  | { status: 'ready'; result: FixResult }
  | {
      status: 'error';
      message: string;
      noKey: boolean;
      result: FixResult | null;
    };

const sum = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});

// The current text: the open buffer (unsaved edits included), else the file.
async function currentText(project: string, path: string): Promise<string | null> {
  const buffer = buffersStore.getState().buffers[bufferKey(project, path)];
  if (buffer) return buffer.content;
  return workspace.readFile(project, path).catch(() => null);
}

export function FixSheet({ project, request, onClose }: FixSheetProps) {
  const styles = useStyles();
  const [state, setState] = useState<State>({ status: 'idle' });
  // First use without a provider: the setup sheet shows instead of this one.
  const [setupOpen, setSetupOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const model = useStore(aiSettings, chatModelOf);

  const run = useCallback(
    async (mode: FixMode, previous: FixResult | null) => {
      if (!request) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setState({
        status: 'loading',
        mode,
        result: mode === 'explain' ? previous : null,
      });
      try {
        if (!aiReady('chat')) throw new AiError('Set up an AI provider and key to get fixes.', 'no-key');
        const files = await workspace.listFiles(project).catch(() => [] as string[]);
        const source: ContextSource = {
          files,
          read: (path) => currentText(project, path),
          problems: (path) => fileDiagnostics(diagnosticsStore.getState(), project, path),
        };
        const ctx = await gatherContext(request, source, project);
        if (!ctx.files.length && !ctx.output) throw new AiError("Couldn't read the file with the problem.", 'other');
        const result = await requestFix(ctx, {
          mode,
          previous: previous?.explanation,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        // Explain keeps the suggested edits and replaces only the words.
        const next =
          mode === 'explain' && previous
            ? {
                ...previous,
                explanation: result.explanation,
                usage: sum(previous.usage, result.usage),
              }
            : previous
              ? { ...result, usage: sum(previous.usage, result.usage) }
              : result;
        setState({ status: 'ready', result: next });
      } catch (e) {
        if (controller.signal.aborted) return;
        haptic('error');
        const noKey = e instanceof AiError && e.kind === 'no-key';
        if (noKey) setSetupOpen(true);
        setState({
          status: 'error',
          message: e instanceof Error ? e.message : String(e),
          noKey,
          result: previous,
        });
      }
    },
    [project, request],
  );

  useEffect(() => {
    if (request) run('fix', null);
    else {
      setSetupOpen(false);
      abort.current?.abort();
      setState({ status: 'idle' });
    }
    return () => abort.current?.abort();
  }, [request, run]);

  const result = state.status === 'idle' ? null : state.result;
  const changes = result?.changes ?? [];
  const hunks = changes.map((c) => ({
    change: c,
    hunks: diffText(c.before, c.after, 2) ?? [],
  }));
  const count = hunks.reduce((n, h) => n + Math.max(1, h.hunks.length), 0);
  const busy = state.status === 'loading';

  const apply = async () => {
    if (!result) return;
    try {
      // Nothing is written unless every file is still as the fix saw it.
      for (const c of changes) {
        if ((await currentText(project, c.path)) !== c.before) throw new Error(`${c.path} changed since the fix was suggested. Try again.`);
      }
      for (const c of changes) {
        const buffers = buffersStore.getState();
        if (buffers.buffers[bufferKey(project, c.path)]) buffers.edit(project, c.path, c.after);
        else await workspace.writeFile(project, c.path, c.after);
      }
      haptic('success');
      onClose();
    } catch (e) {
      haptic('error');
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        noKey: false,
        result,
      });
    }
  };

  return (
    <>
      <AiSetupSheet
        visible={request !== null && setupOpen}
        onClose={() => setSetupOpen(false)}
        onReady={() => {
          setSetupOpen(false);
          run('fix', null);
        }}
      />
      <Sheet visible={request !== null && !setupOpen} onClose={onClose} scrollable>
        <View style={styles.header} testID="fix-sheet">
          <Text variant="title" style={styles.flex}>
            ✦ Suggested fix
          </Text>
          <View style={styles.chip} testID="fix-model">
            <Text variant="mono" style={styles.chipText} numberOfLines={1}>
              {modelLabel(model.model)}
            </Text>
          </View>
        </View>

        {busy && !(state.mode === 'explain' && result) ? <Skeleton /> : null}

        {result && (
          <View style={styles.explanation} testID="fix-explanation">
            {busy && state.mode === 'explain' ? (
              <Text variant="muted">Thinking…</Text>
            ) : (
              <RichText text={result.explanation || (changes.length ? '' : 'No code change was suggested.')} />
            )}
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.errorBox} testID="fix-error">
            <Text variant="error" selectable>
              {state.message}
            </Text>
            {state.noKey && <Button title="Set up AI" icon="key" onPress={() => setSetupOpen(true)} testID="fix-setup" />}
          </View>
        )}

        {hunks.map(({ change, hunks: h }) => (
          <DiffCard key={change.path} change={change} hunks={h} />
        ))}

        {result && result.dropped > 0 && (
          <Text variant="muted" testID="fix-dropped">
            {result.dropped === 1 ? '1 suggested edit' : `${result.dropped} suggested edits`} didn’t match the file and {result.dropped === 1 ? 'was' : 'were'} left out.
          </Text>
        )}
        {result?.truncated && <Text variant="muted">The answer was cut off at the length limit, so some edits may be missing.</Text>}

        {(result || state.status === 'error') && !(state.status === 'error' && state.noKey) && (
          <View style={styles.buttons}>
            <Button title="Explain" variant="outline" icon="help-circle" onPress={() => run('explain', result)} disabled={busy} testID="fix-explain" />
            <Button title="Try again" variant="outline" icon="refresh-cw" onPress={() => run(result ? 'retry' : 'fix', result)} disabled={busy} testID="fix-retry" />
            {changes.length > 0 && (
              <View style={styles.flex}>
                <Button title={`Apply ${count} change${count === 1 ? '' : 's'}`} icon="check" onPress={apply} disabled={busy} testID="fix-apply" />
              </View>
            )}
          </View>
        )}
        {result && (
          <Text variant="muted" style={styles.cost} testID="fix-cost">
            {costLine(result.usage, model)}
          </Text>
        )}
      </Sheet>
    </>
  );
}

function Skeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton} testID="fix-loading" accessibilityLabel="Thinking">
      <View style={[styles.bar, { width: '92%' }]} />
      <View style={[styles.bar, { width: '70%' }]} />
      <View style={[styles.bar, styles.block]} />
      <Text variant="muted">Thinking…</Text>
    </View>
  );
}

// Text with `inline code` drawn as mono chips.
export function RichText({ text }: { text: string }) {
  const styles = useStyles();
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <Text style={styles.body} selectable>
      {parts.map((p, i) =>
        p.length > 2 && p.startsWith('`') && p.endsWith('`') ? (
          <Text key={i} variant="mono" style={styles.code}>
            {` ${p.slice(1, -1)} `}
          </Text>
        ) : (
          p.replace(/\*\*([^*]+)\*\*/g, '$1')
        ),
      )}
    </Text>
  );
}

const badgeFor = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return (dot > 0 ? name.slice(dot + 1) : name).slice(0, 4).toUpperCase();
};

function DiffCard({ change, hunks }: { change: FileChange; hunks: Hunk[] }) {
  const styles = useStyles();
  const colors = useColors();
  const added = hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === 'add').length, 0);
  const removed = hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === 'del').length, 0);
  return (
    <View style={styles.card} testID={`fix-file-${change.path}`}>
      <View style={styles.cardHeader}>
        <View style={styles.badge}>
          <Text variant="mono" style={styles.badgeText}>
            {badgeFor(change.path)}
          </Text>
        </View>
        <Text variant="label" style={styles.flex} numberOfLines={1}>
          {change.path}
        </Text>
        <Text variant="mono" style={[styles.stat, { color: colors.success }]}>
          +{added}
        </Text>
        <Text variant="mono" style={[styles.stat, { color: colors.destructive }]}>
          −{removed}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.lines}>
          {hunks.map((h, i) => (
            <View key={`${h.oldStart}-${i}`}>
              {i > 0 && (
                <Text variant="mono" style={styles.gap}>
                  ⋯
                </Text>
              )}
              {h.lines.map((l, j) => {
                const del = l.kind === 'del';
                const add = l.kind === 'add';
                return (
                  <View
                    key={j}
                    style={[styles.line, del && { backgroundColor: colors.destructiveSoft }, add && { backgroundColor: colors.successSoft }]}
                    testID={del ? 'fix-del' : add ? 'fix-add' : undefined}
                  >
                    <Text variant="mono" style={styles.number}>
                      {del ? l.oldLine : (l.newLine ?? '')}
                    </Text>
                    <Text variant="mono" style={[styles.sign, del && { color: colors.destructive }, add && { color: colors.success }]}>
                      {del ? '−' : add ? '+' : ' '}
                    </Text>
                    <Text variant="mono" style={[styles.codeLine, l.kind === 'same' && { color: colors.mutedForeground }, del && styles.struck]}>
                      {lineText(l.text) || ' '}
                    </Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    maxWidth: 180,
  },
  chipText: { fontSize: fontSizes.xs, color: colors.brand },
  explanation: { gap: spacing.xs },
  body: {
    color: colors.foreground,
    fontFamily: fonts.sans.regular,
    fontSize: fontSizes.md,
    lineHeight: 22,
  },
  code: {
    fontSize: fontSizes.sm,
    backgroundColor: colors.secondary,
    color: colors.foreground,
  },
  errorBox: { gap: spacing.sm },
  skeleton: { gap: spacing.sm, paddingVertical: spacing.xs },
  bar: { height: 12, borderRadius: 6, backgroundColor: colors.secondary },
  block: { height: 64, width: '100%', borderRadius: radius.md },
  card: {
    borderWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.card,
    borderBottomWidth: borderWidth,
    borderBottomColor: colors.border,
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.brandSoft,
  },
  badgeText: { fontSize: fontSizes.xs, color: colors.brand },
  stat: { fontSize: fontSizes.xs },
  lines: { paddingVertical: spacing.xs, minWidth: '100%' },
  line: { flexDirection: 'row' },
  number: {
    width: 36,
    textAlign: 'right',
    paddingRight: spacing.xs,
    color: colors.mutedForeground,
    fontSize: fontSizes.xs,
    lineHeight: 20,
  },
  sign: {
    width: 14,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
    color: colors.mutedForeground,
  },
  codeLine: {
    fontFamily: fonts.mono.regular,
    fontSize: 13,
    lineHeight: 20,
    paddingRight: spacing.md,
  },
  struck: { textDecorationLine: 'line-through' },
  gap: {
    color: colors.mutedForeground,
    fontSize: fontSizes.xs,
    paddingLeft: 50,
    lineHeight: 18,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  cost: { fontSize: fontSizes.xs, textAlign: 'center' },
}));
