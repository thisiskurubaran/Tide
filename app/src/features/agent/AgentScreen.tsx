import { Icon } from '../../components/Icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, ScrollViewInstance, TextInput, TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { FileBadge } from '../../components/FileBadge';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { AgentSetup, ModelChip, formatCost, useAiSetup, useCostEstimate } from './aiGlue';
import { countLines, changeHunks } from './changes';
import { answerApproval, clearConversation, sendToAgent, setDraft, StepRow, stopAgent, Turn, useAgentSession, useChanges } from './session';

export const formatTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export const formatElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Re-renders every second while `on`, for the elapsed time.
function useTicker(on: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
}

// The agent's chat for one project: the user's requests, what the agent did,
// command approvals, and the way to review its changes.
export function AgentScreen() {
  const { project = '' } = useLocalSearchParams<{ project: string }>();
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const session = useAgentSession(project);
  const pending = useChanges((s) => s.byProject[project]);
  const changeCount = pending ? Object.keys(pending).length : 0;
  const [text, setText] = useState(session.draft);
  const [picking, setPicking] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const input = useRef<TextInputInstance>(null);
  const setup = useAiSetup();

  // "Ask for changes" on the review screen leaves a draft here.
  useEffect(() => {
    if (session.draft) {
      setText(session.draft);
      setDraft(project, '');
      input.current?.focus();
    }
  }, [session.draft, project]);

  const send = () => {
    const prompt = text.trim();
    if (!prompt || session.running) return;
    // Without a provider, the setup sheet comes first and the message goes once it's ready.
    setup.ensure('agent', () => {
      setText('');
      sendToAgent(project, prompt);
    });
  };

  const mention = (path: string) => {
    setPicking(false);
    setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${path} `);
    input.current?.focus();
  };

  return (
    <KeyboardAvoidingView style={[styles.screen, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} testID="agent-screen">
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} testID="back" />
        <Text variant="title" numberOfLines={1} style={styles.title}>
          Agent · {project}
        </Text>
        <ModelChip />
        <IconButton icon="trash-2" label="Clear conversation" onPress={() => clearConversation(project)} disabled={session.running || session.turns.length === 0} testID="agent-clear" />
      </View>

      <ScrollView
        ref={scroll}
        style={styles.fill}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      >
        {session.turns.length === 0 && <Intro project={project} />}
        {session.turns.map((turn, i) => (
          <TurnView key={turn.id} project={project} turn={turn} approval={i === session.turns.length - 1 ? session.approval : null} onSetup={setup.open} />
        ))}
      </ScrollView>

      {!session.running && changeCount > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/agent-review', params: { project } })}
          style={({ pressed }) => [styles.reviewBar, pressed && { opacity: 0.8 }]}
          testID="agent-review"
        >
          <Icon name="git-pull-request" size={16} color={colors.brandForeground} />
          <Text style={styles.reviewText}>
            Review {changeCount} {changeCount === 1 ? 'change' : 'changes'}
          </Text>
          <PendingStats project={project} />
          <Icon name="chevron-right" size={16} color={colors.brandForeground} />
        </Pressable>
      )}

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          placeholder="Ask for a change…"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={styles.input}
          testID="agent-input"
        />
        <View style={styles.composerRow}>
          <Pressable accessibilityRole="button" accessibilityLabel="Mention a file" onPress={() => setPicking(true)} style={styles.chip} testID="agent-mention">
            <Text style={styles.chipText}>@ files</Text>
          </Pressable>
          <View style={styles.fill} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !text.trim() || session.running }}
            disabled={!text.trim() || session.running}
            onPress={send}
            style={({ pressed }) => [styles.send, (!text.trim() || session.running) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
            testID="agent-send"
          >
            <Icon name="arrow-up" size={18} color={colors.brandForeground} />
          </Pressable>
        </View>
      </View>

      <FilePicker project={project} visible={picking} onClose={() => setPicking(false)} onPick={mention} />
      {setup.sheet}
    </KeyboardAvoidingView>
  );
}

function Intro({ project }: { project: string }) {
  const styles = useStyles();
  return (
    <View style={styles.intro}>
      <Text variant="title">What should change in {project}?</Text>
      <Text variant="muted">
        The agent reads your code, makes edits and runs commands. It asks before every command, and nothing it changes is kept until you review the diff. Mention files with @ to point it at them.
      </Text>
    </View>
  );
}

function PendingStats({ project }: { project: string }) {
  const styles = useStyles();
  const pending = useChanges((s) => s.byProject[project]);
  const { added, removed } = useMemo(() => countLines(Object.values(pending ?? {}).flatMap(changeHunks)), [pending]);
  return (
    <Text style={[styles.reviewText, styles.reviewStats]}>
      +{added} −{removed}
    </Text>
  );
}

function TurnView({ project, turn, approval, onSetup }: { project: string; turn: Turn; approval: { command: string; key: string } | null; onSetup(): void }) {
  const styles = useStyles();
  const colors = useColors();
  const running = turn.status === 'running';
  useTicker(running);
  const cost = useCostEstimate(turn.usage);
  const tokens = turn.usage.inputTokens + turn.usage.outputTokens;
  const elapsed = (turn.endedAt ?? Date.now()) - turn.startedAt;

  return (
    <View style={styles.turn}>
      <View style={styles.userBubble} testID="agent-user-message">
        <Text style={styles.userText}>{turn.prompt}</Text>
      </View>
      <View style={styles.card} testID="agent-turn">
        {turn.items.map((item, i) =>
          item.kind === 'text' ? (
            item.text.trim() ? (
              <Text key={i} style={styles.agentText} selectable>
                {item.text.trim()}
              </Text>
            ) : null
          ) : (
            <StepRowView key={item.step.id} row={item.step} />
          ),
        )}
        {running && turn.items.length === 0 && (
          <View style={styles.thinking}>
            <ActivityIndicator size="small" color={colors.brand} />
            <Text variant="muted">Thinking…</Text>
          </View>
        )}
        {approval && <ApprovalCard project={project} command={approval.command} commandKey={approval.key} />}
        {!running && turn.message ? <EndMessage turn={turn} onSetup={onSetup} /> : null}
        <View style={styles.footer}>
          <Text variant="muted" style={styles.footerText} testID="agent-usage">
            {formatElapsed(elapsed)} · {formatTokens(tokens)} tokens{cost !== null ? ` · ≈ ${formatCost(cost)}` : ''}
          </Text>
          {running && (
            <Pressable accessibilityRole="button" onPress={() => stopAgent(project)} style={styles.stop} testID="agent-stop">
              <Icon name="square" size={12} color={colors.destructive} />
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function EndMessage({ turn, onSetup }: { turn: Turn; onSetup(): void }) {
  const styles = useStyles();
  const colors = useColors();
  if (turn.status === 'error') {
    return (
      <View style={styles.endBox}>
        <Text variant="error">{turn.message}</Text>
        {turn.errorKind === 'no-key' || turn.errorKind === 'auth' ? <AgentSetup onPress={onSetup} /> : null}
      </View>
    );
  }
  if (turn.status === 'stopped') return <Text variant="muted">Stopped. Changes made so far are still waiting for review.</Text>;
  return (
    <View style={styles.summary}>
      <Icon name="check-circle" size={15} color={colors.success} style={{ marginTop: 2 }} />
      <Text style={[styles.agentText, styles.fill]} selectable>
        {turn.message}
      </Text>
    </View>
  );
}

const VERB_DONE: Record<string, string> = { Listed: 'Listed', Read: 'Read', Searched: 'Searched', Edited: 'Edited', Created: 'Created', Ran: 'Ran', Finished: 'Finished', Used: 'Used' };
const VERB_RUNNING: Record<string, string> = { Listed: 'Listing', Read: 'Reading', Searched: 'Searching', Edited: 'Editing', Created: 'Creating', Ran: 'Running', Finished: 'Finishing', Used: 'Using' };

function StepRowView({ row }: { row: StepRow }) {
  const styles = useStyles();
  const colors = useColors();
  if (row.view.verb === 'Finished') return null;
  const dot =
    row.status === 'done' ? (
      <Icon name="check" size={13} color={colors.success} />
    ) : row.status === 'running' ? (
      <View style={[styles.dotFill, { backgroundColor: colors.brand }]} />
    ) : row.status === 'waiting' ? (
      <View style={[styles.dotRing, { borderColor: colors.mutedForeground }]} />
    ) : row.status === 'denied' ? (
      <Icon name="slash" size={12} color={colors.mutedForeground} />
    ) : (
      <Icon name="x" size={13} color={colors.destructive} />
    );
  const verb = row.status === 'running' ? VERB_RUNNING[row.view.verb] : row.status === 'waiting' ? `Waiting to run` : VERB_DONE[row.view.verb];
  return (
    <View style={styles.step} testID={`agent-step-${row.status}`}>
      <View style={styles.dot}>{dot}</View>
      <View style={styles.stepBody}>
        <View style={styles.stepLine}>
          <Text style={styles.verb}>{verb}</Text>
          {row.view.chips.map((c, i) => (
            <View key={i} style={styles.fileChip}>
              {row.view.verb !== 'Ran' && row.view.verb !== 'Searched' && /\.[a-z0-9]+$/i.test(c) && <FileBadge name={c} size={12} />}
              <Text variant="mono" style={styles.fileChipText} numberOfLines={1}>
                {c}
              </Text>
            </View>
          ))}
          {row.view.added !== undefined && <Text style={[styles.count, { color: colors.success }]}>+{row.view.added}</Text>}
          {row.view.removed !== undefined && row.view.removed > 0 && <Text style={[styles.count, { color: colors.destructive }]}>−{row.view.removed}</Text>}
        </View>
        {row.detail && row.status !== 'done' ? (
          <Text variant="muted" numberOfLines={3} style={styles.stepDetail}>
            {row.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ApprovalCard({ project, command, commandKey }: { project: string; command: string; commandKey: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.approval} testID="agent-approval">
      <View style={styles.approvalTitle}>
        <Icon name="terminal" size={14} color={colors.warning} />
        <Text style={[styles.verb, { color: colors.warning }]}>Allow this command?</Text>
      </View>
      <View style={styles.commandBox}>
        <Text variant="mono" selectable>
          $ {command}
        </Text>
      </View>
      <View style={styles.approvalButtons}>
        <Button title="Deny" variant="outline" onPress={() => answerApproval(project, 'deny')} testID="agent-deny" />
        <Button title="Allow once" variant="outline" onPress={() => answerApproval(project, 'once')} testID="agent-allow-once" />
        {commandKey ? <Button title={`Always for ${commandKey}`} onPress={() => answerApproval(project, 'always')} testID="agent-allow-always" /> : null}
      </View>
    </View>
  );
}

function FilePicker({ project, visible, onClose, onPick }: { project: string; visible: boolean; onClose(): void; onPick(path: string): void }) {
  const styles = useStyles();
  const colors = useColors();
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    workspace.listFiles(project).then((f) => setFiles(f.sort()), () => setFiles([]));
  }, [visible, project]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 60);
  }, [files, query]);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">Mention a file</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Filter files"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.filter}
        testID="agent-mention-filter"
      />
      <ScrollView style={styles.pickList} keyboardShouldPersistTaps="handled">
        {shown.map((f) => (
          <Pressable key={f} accessibilityRole="button" onPress={() => onPick(f)} style={({ pressed }) => [styles.pickRow, pressed && { backgroundColor: colors.secondary }]}>
            <FileBadge name={f} />
            <Text variant="mono" numberOfLines={1} style={styles.fill}>
              {f}
            </Text>
          </Pressable>
        ))}
        {shown.length === 0 && <Text variant="muted">No files match.</Text>}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: borderWidth, borderBottomColor: colors.border },
  title: { flex: 1 },
  content: { padding: spacing.md, gap: spacing.lg },
  intro: { gap: spacing.sm, paddingTop: spacing.lg },
  turn: { gap: spacing.sm },
  userBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: colors.brand, borderRadius: radius.lg, borderBottomRightRadius: radius.sm / 2, paddingHorizontal: spacing.md - 2, paddingVertical: spacing.sm },
  userText: { color: colors.brandForeground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md },
  card: { backgroundColor: colors.card, borderWidth, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md - 4, gap: spacing.sm },
  agentText: { color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md, lineHeight: fontSizes.md * 1.45 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: { width: 16, height: 20, alignItems: 'center', justifyContent: 'center' },
  dotFill: { width: 8, height: 8, borderRadius: 4 },
  dotRing: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  stepBody: { flex: 1, gap: 2 },
  stepLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs + 2, minHeight: 20 },
  verb: { color: colors.foreground, fontFamily: fonts.sans.medium, fontSize: fontSizes.sm },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 220, backgroundColor: colors.secondary, borderRadius: radius.sm / 2, paddingHorizontal: 6, paddingVertical: 1 },
  fileChipText: { fontSize: fontSizes.xs, flexShrink: 1 },
  count: { fontFamily: fonts.mono.semibold, fontSize: fontSizes.xs },
  stepDetail: { fontSize: fontSizes.xs },
  approval: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.warning, backgroundColor: colors.warningSoft, borderRadius: radius.md, padding: spacing.sm + 2, gap: spacing.sm },
  approvalTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs + 2 },
  commandBox: { backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm },
  approvalButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  endBox: { gap: spacing.sm },
  summary: { flexDirection: 'row', gap: spacing.sm, borderTopWidth: borderWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
  footerText: { flex: 1, fontSize: fontSizes.xs, fontFamily: fonts.mono.regular },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth, borderColor: colors.destructive, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4 },
  stopText: { color: colors.destructive, fontFamily: fonts.sans.medium, fontSize: fontSizes.sm },
  reviewBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, borderRadius: radius.md, backgroundColor: colors.brand },
  reviewText: { color: colors.brandForeground, fontFamily: fonts.sans.semibold, fontSize: fontSizes.sm },
  reviewStats: { flex: 1, textAlign: 'right', fontFamily: fonts.mono.regular },
  composer: { borderTopWidth: borderWidth, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  input: { minHeight: 40, maxHeight: 140, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md, paddingVertical: spacing.xs },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { borderWidth, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: spacing.sm + 2, paddingVertical: 4, backgroundColor: colors.secondary },
  chipText: { color: colors.mutedForeground, fontFamily: fonts.mono.regular, fontSize: fontSizes.xs },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  filter: { borderWidth, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm + 4, paddingVertical: spacing.sm, color: colors.foreground, fontFamily: fonts.sans.regular, fontSize: fontSizes.md, marginTop: spacing.sm },
  pickList: { maxHeight: 360, marginTop: spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
}));
