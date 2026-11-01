import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { HtmlView } from '../../components/HtmlView';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { buffersStore } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { diffText } from '../../extensions/gitPro/diff';
import { DiffView } from '../../extensions/gitPro/DiffView';
import { markdownToHtml } from '../preview/render';
import { AiAnswer, AiTask, createClient, describeError, MODELS, runTask } from './assistant';
import { getApiKey, useAiSettings } from './settings';

export type AiMode = 'explain' | 'fix' | 'ask';

interface AiSheetProps {
  // Open with this mode; null closes the sheet.
  mode: AiMode | null;
  project: string;
  path: string | null;
  onClose(): void;
}

// Explain, fix or change the open file with Claude (Tide Pro). Changes are
// shown as a diff and applied to the editor, unsaved, so Undo still works.
export function AiSheet({ mode, project, path, onClose }: AiSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const model = useAiSettings((s) => s.model);
  const hasKey = useAiSettings((s) => s.hasKey);
  const [tab, setTab] = useState<AiMode>('explain');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ original: string; result: AiAnswer } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'answer' | 'changes'>('answer');

  useEffect(() => {
    if (!mode) return;
    setTab(mode);
    setAnswer(null);
    setError(null);
    setView('answer');
  }, [mode]);

  const run = async () => {
    if (!path) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const key = await getApiKey();
      if (!key) throw new Error('Add your Anthropic API key in Settings, AI assistant.');
      await buffersStore.getState().load(project, path);
      const original = buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '';
      const task: AiTask = tab === 'ask' ? { kind: 'ask', prompt: prompt.trim() } : { kind: tab };
      const result = await runTask(createClient(key), model, task, { path, content: original });
      setAnswer({ original, result });
      setView(result.code !== null ? 'changes' : 'answer');
      haptic('success');
    } catch (e) {
      haptic('error');
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!answer?.result.code || !path) return;
    buffersStore.getState().edit(project, path, answer.result.code.endsWith('\n') || !answer.original.endsWith('\n') ? answer.result.code : `${answer.result.code}\n`);
    haptic('success');
    onClose();
  };

  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;
  return (
    <Sheet visible={mode !== null} onClose={onClose} scrollable>
      <Text variant="title">AI assistant</Text>
      <Text variant="muted" numberOfLines={1}>
        {path ?? 'Open a file first'} · {modelLabel}
      </Text>
      <Segmented<AiMode>
        value={tab}
        onChange={(t) => {
          setTab(t);
          setAnswer(null);
          setError(null);
        }}
        options={[
          { value: 'explain', label: 'Explain' },
          { value: 'fix', label: 'Fix' },
          { value: 'ask', label: 'Ask' },
        ]}
        testID="ai-mode"
      />
      {tab === 'ask' && (
        <TextInput
          value={prompt}
          onChangeText={setPrompt}
          placeholder="e.g. Add input validation to createUser"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={styles.prompt}
          testID="ai-prompt"
        />
      )}
      {hasKey === false && (
        <View style={styles.row}>
          <Text variant="muted" style={styles.flex}>
            Add your Anthropic API key first.
          </Text>
          <Button title="Settings" variant="outline" onPress={() => (onClose(), router.push('/settings/ai'))} />
        </View>
      )}
      <Button
        title={busy ? 'Asking Claude…' : tab === 'explain' ? 'Explain this file' : tab === 'fix' ? 'Find and fix bugs' : 'Ask'}
        icon="cpu"
        onPress={run}
        disabled={busy || !path || hasKey === false || (tab === 'ask' && !prompt.trim())}
        testID="ai-run"
      />
      {busy && <ActivityIndicator color={colors.mutedForeground} />}
      {error && (
        <Text variant="error" selectable>
          {error}
        </Text>
      )}
      {answer && (
        <>
          {answer.result.code !== null && (
            <Segmented<'answer' | 'changes'>
              value={view}
              onChange={setView}
              options={[
                { value: 'changes', label: 'Changes' },
                { value: 'answer', label: 'Answer' },
              ]}
            />
          )}
          {view === 'changes' && answer.result.code !== null ? (
            <DiffView hunks={diffText(answer.original, answer.result.code)} empty="No changes to the file." />
          ) : (
            <View style={styles.answer}>
              <HtmlView body={markdownToHtml(answer.result.text)} testID="ai-answer" />
            </View>
          )}
          {answer.result.code !== null && (
            <View style={styles.row}>
              <Text variant="muted" style={styles.flex}>
                Applies to the editor, unsaved.
              </Text>
              <Button title="Apply" icon="check" onPress={apply} testID="ai-apply" />
            </View>
          )}
        </>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  prompt: {
    minHeight: 72,
    maxHeight: 160,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.sans.regular,
    fontSize: fontSizes.md,
    textAlignVertical: 'top',
  },
  answer: { height: 380, borderRadius: radius.md, overflow: 'hidden', borderWidth, borderColor: colors.border },
}));
