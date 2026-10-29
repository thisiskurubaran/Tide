import { Alert, Pressable, ScrollView } from 'react-native';

import { PromptSheet } from '../../components/PromptSheet';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { radius, spacing } from '../../theme/tokens';
import { diagnosticsStore } from '../diagnostics';
import { toDiagnostics } from '../formatLint/lintMessages';
import { problemsCommand, problemsPanel } from '../ProblemsPanel';
import type { Location, PanelProps, ProjectContext, TideExtension } from '../types';
import { applyEdits, createTsClient, TS_FILE } from './client';

const ts = createTsClient(localRunner);

const content = (project: string, path: string) => buffersStore.getState().buffers[bufferKey(project, path)]?.content;

// The symbol under the cursor, for the commands that act on it.
function atCursor(ctx: ProjectContext) {
  const path = ctx.activePath();
  const offset = ctx.cursor();
  const text = path ? content(ctx.project, path) : undefined;
  if (!path || offset === null || text === undefined || !TS_FILE.test(path)) return null;
  return { path, offset, text };
}

// Results shared between the commands and their panels.
let references: Location[] = [];

async function goToDefinition(ctx: ProjectContext) {
  const at = atCursor(ctx);
  if (!at) return;
  const [target] = await ts.definition(ctx.project, at.path, at.text, at.offset);
  if (target) ctx.openFile(target.path, target.line, target.column);
  else Alert.alert('Go to definition', 'No definition found in this project.');
}

async function findReferences(ctx: ProjectContext) {
  const at = atCursor(ctx);
  if (!at) return;
  references = await ts.references(ctx.project, at.path, at.text, at.offset);
  ctx.openPanel('intellisense.references');
}

// Renames across the project: open files are edited in their buffers (and
// saved by autosave), others on disk.
async function rename(ctx: ProjectContext, newName: string) {
  const at = atCursor(ctx);
  if (!at) throw new Error('Put the cursor on a symbol first');
  // Unsaved edits in other files must be what the service renames in.
  for (const [k, b] of Object.entries(buffersStore.getState().buffers)) {
    const [project, path] = k.split('\u0000');
    if (project === ctx.project && TS_FILE.test(path)) ts.sync(project, path, b.content);
  }
  const files = await ts.rename(ctx.project, at.path, at.text, at.offset, newName);
  for (const f of files) {
    const open = content(ctx.project, f.path);
    if (open !== undefined) buffersStore.getState().edit(ctx.project, f.path, applyEdits(open, f.edits));
    else await workspace.writeFile(ctx.project, f.path, applyEdits(await workspace.readFile(ctx.project, f.path), f.edits));
  }
  return files.reduce((n, f) => n + f.edits.length, 0);
}

function ReferencesPanel({ ctx, visible, onClose }: PanelProps) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">
        {references.length} reference{references.length === 1 ? '' : 's'}
      </Text>
      <ScrollView style={styles.list}>
        {references.map((r, i) => (
          <Pressable accessibilityRole="button"
            key={`${r.path}:${r.line}:${r.column}:${i}`}
            testID={`reference-${i}`}
            onPress={() => {
              onClose();
              ctx.openFile(r.path, r.line, r.column);
            }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
          >
            <Text variant="muted">
              {r.path}:{r.line}
            </Text>
            <Text variant="mono" numberOfLines={1}>
              {r.preview}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

function RenamePanel({ ctx, visible, onClose }: PanelProps) {
  const at = visible ? atCursor(ctx) : null;
  const [word] = at ? (/^[\w$]+/.exec(at.text.slice(at.text.slice(0, at.offset).search(/[\w$]*$/))) ?? ['']) : [''];
  return (
    <PromptSheet
      visible={visible}
      title="Rename symbol"
      initialValue={word}
      placeholder="New name"
      confirmLabel="Rename"
      onClose={onClose}
      onSubmit={async (value) => {
        if (!/^[A-Za-z_$][\w$]*$/.test(value)) throw new Error('Not a valid name');
        await rename(ctx, value);
      }}
    />
  );
}

export const intellisenseExtension: TideExtension = {
  id: 'intellisense',
  editor: { language: true },
  language: {
    supports: (path) => TS_FILE.test(path),
    completion: ({ project, path, content: text, offset }) => ts.completions(project, path, text, offset),
    hover: ({ project, path, content: text, offset }) => ts.hover(project, path, text, offset),
    definition: ({ project, path, content: text, offset }) => ts.definition(project, path, text, offset),
  },
  commands: (ctx) => [
    { id: 'intellisense.definition', title: 'Go to definition', icon: 'corner-up-right', hint: 'F12', run: () => goToDefinition(ctx) },
    { id: 'intellisense.references', title: 'Find references', icon: 'link', run: () => findReferences(ctx) },
    { id: 'intellisense.rename', title: 'Rename symbol', icon: 'edit-3', run: () => atCursor(ctx) && ctx.openPanel('intellisense.rename') },
    { id: 'intellisense.complete', title: 'Trigger suggestions', icon: 'list', run: () => ctx.editor()?.send({ type: 'complete' }) },
    problemsCommand(ctx),
  ],
  panels: [{ id: 'intellisense.references', component: ReferencesPanel }, { id: 'intellisense.rename', component: RenamePanel }, problemsPanel],
  documentChanged(ctx, path, text) {
    if (!TS_FILE.test(path)) return;
    ts.diagnostics(ctx.project, path, text)
      .then((messages) => diagnosticsStore.getState().set(ctx.project, path, 'ts', toDiagnostics(text, messages, 'ts')))
      .catch((e) => console.warn('Type check failed', e));
  },
  deactivate() {
    diagnosticsStore.getState().clearSource('ts');
    ts.stop();
  },
};

const useStyles = makeStyles(() => ({
  list: { maxHeight: 480 },
  row: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.sm, gap: 2 },
}));
