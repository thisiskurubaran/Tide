import { Icon } from '../../components/Icon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '../../components/ActionSheet';
import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { PromptSheet } from '../../components/PromptSheet';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { runGit } from '../../features/git/runGit';
import { localRunner } from '../../runtime';
import { buffersStore, projectsStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { PanelProps } from '../types';
import { Branches, CommitInfo, createGitPro, FileChange, isStaged, isUnstaged, PickResult, StashEntry, Status, Tag } from './api';
import { applyHunk, diffText, Hunk, revertHunk } from './diff';
import { DiffView } from './DiffView';
import { changedFiles } from '../../features/git/SourceControlSheet';
import { SuggestMessageButton } from '../../features/ai/SuggestMessageButton';
import { trackGit } from '../../features/widgets/liveActivities';

type Tab = 'changes' | 'branches' | 'history';
type Detail =
  | { kind: 'file'; path: string; staged: boolean }
  // A stash shows like a commit, without Cherry-pick.
  | { kind: 'commit'; commit: CommitInfo; stash?: boolean }
  | { kind: 'commitFile'; commit: CommitInfo; path: string };

const label = (code: string) => {
  if (code === '??') return 'new';
  if (code === 'UU') return 'conflict';
  const c = code.trim()[0];
  return c === 'M' ? 'modified' : c === 'A' ? 'added' : c === 'D' ? 'deleted' : code.trim();
};

const ago = (seconds: number) => {
  const s = Date.now() / 1000 - seconds;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(seconds * 1000).toLocaleDateString();
};

export function GitProPanel({ ctx, visible, onClose }: PanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { project } = ctx;
  const git = useMemo(() => createGitPro((args) => runGit(localRunner, project, args)), [project]);
  const [tab, setTab] = useState<Tab>('changes');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState<Status | null | 'none'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    // Unsaved editor text would otherwise be invisible to git.
    await buffersStore.getState().flushProject(project);
    try {
      setStatus(await git.status());
    } catch {
      setStatus('none');
    }
  }, [git, project]);

  useEffect(() => {
    if (!visible) return;
    setDetail(null);
    setError(null);
    setStatus(null);
    refresh();
  }, [visible, refresh]);

  // Runs a git step, then brings the file tree and open files up to date with what it changed.
  const act = useCallback(
    async (step: () => Promise<unknown>, touchesFiles = false) => {
      setBusy(true);
      setError(null);
      try {
        await buffersStore.getState().flushProject(project);
        await step();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        if (touchesFiles) {
          await projectsStore.getState().loadTree(project);
          // Every clean buffer, not only open tabs: a stale one would be autosaved back over the change.
          await buffersStore.getState().reloadProject(project);
        }
        setBusy(false);
        await refresh();
      }
    },
    [project, refresh],
  );

  const shared = { git, act, busy, setDetail, setTab, ctx, refresh };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          {detail ? (
            <IconButton icon="chevron-left" label="Back" onPress={() => setDetail(null)} testID="gp-back" />
          ) : (
            <IconButton icon="x" label="Close" onPress={onClose} testID="gp-close" />
          )}
          <Text variant="title" style={styles.title} numberOfLines={1}>
            {detail?.kind === 'file' || detail?.kind === 'commitFile' ? detail.path : detail?.kind === 'commit' ? detail.commit.message.split('\n')[0] : 'Source control'}
          </Text>
          {status && status !== 'none' && (
            <View style={styles.branch}>
              <Icon name="git-branch" size={14} color={colors.mutedForeground} />
              <Text variant="muted" testID="gp-branch">
                {status.branch ?? 'detached'}
              </Text>
            </View>
          )}
        </View>
        {!detail && status !== 'none' && (
          <View style={styles.tabs}>
            <Segmented<Tab>
              testID="gp-tab"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'changes', label: 'Changes' },
                { value: 'branches', label: 'Branches' },
                { value: 'history', label: 'History' },
              ]}
            />
          </View>
        )}
        {error && (
          <Pressable onPress={() => setError(null)} style={styles.error} accessibilityRole="alert" testID="gp-error">
            <Text variant="error" style={styles.flex}>
              {error}
            </Text>
            <Icon name="x" size={16} color={colors.destructive} />
          </Pressable>
        )}
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]} keyboardShouldPersistTaps="handled">
          {status === null && <Text variant="muted">Reading git status...</Text>}
          {status === 'none' && (
            <View style={styles.gap}>
              <Text variant="muted">This project is not a git repository yet.</Text>
              <Button title="Initialize repository" icon="git-branch" onPress={() => act(() => runGit(localRunner, project, ['init']))} testID="gp-init" />
            </View>
          )}
          {status && status !== 'none' && (
            <>
              {status.operation && <OperationBanner {...shared} status={status} />}
              {detail?.kind === 'file' && <FileDiff {...shared} path={detail.path} staged={detail.staged} />}
              {detail?.kind === 'commit' && <CommitDetail {...shared} commit={detail.commit} stash={!!detail.stash} />}
              {detail?.kind === 'commitFile' && <CommitFileDiff {...shared} commit={detail.commit} path={detail.path} />}
              {!detail && tab === 'changes' && <Changes {...shared} status={status} />}
              {!detail && tab === 'branches' && <BranchList {...shared} status={status} />}
              {!detail && tab === 'history' && <History {...shared} />}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

type Shared = {
  git: ReturnType<typeof createGitPro>;
  act(step: () => Promise<unknown>, touchesFiles?: boolean): Promise<boolean>;
  busy: boolean;
  setDetail(d: Detail | null): void;
  setTab(t: Tab): void;
  ctx: PanelProps['ctx'];
  refresh(): Promise<void>;
};

function Changes({ git, act, busy, setDetail, ctx, status }: Shared & { status: Status }) {
  const styles = useStyles();
  const colors = useColors();
  const [message, setMessage] = useState('');
  const staged = status.changes.filter(isStaged);
  const unstaged = status.changes.filter(isUnstaged);
  const conflicts = status.changes.filter((c) => c.code === 'UU');

  const confirmDiscard = (c: FileChange) =>
    Alert.alert(
      `Discard changes to ${c.path}?`,
      c.code === '??' ? 'This deletes the new file.' : 'This puts the file back to its last staged or committed version.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => act(() => git.discard([c.path]), true) },
      ],
    );

  const row = (c: FileChange, side: 'staged' | 'unstaged') => (
    <Pressable accessibilityRole="button"
      key={`${side}-${c.path}`}
      testID={`gp-${side}-${c.path}`}
      onPress={() => (c.code === 'UU' ? ctx.openFile(c.path, 1) : setDetail({ kind: 'file', path: c.path, staged: side === 'staged' }))}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
    >
      <Text variant="mono" numberOfLines={1} style={styles.flex}>
        {c.path}
      </Text>
      <Text variant="muted" style={{ color: c.code === 'UU' ? colors.destructive : c.code === '??' ? colors.success : colors.warning }}>
        {label(side === 'staged' ? `${c.code[0]} ` : c.code === '??' || c.code === 'UU' ? c.code : ` ${c.code[1]}`)}
      </Text>
      {side === 'staged' ? (
        <IconButton icon="minus" label={`Unstage ${c.path}`} onPress={() => act(() => git.unstage([c.path]))} testID={`gp-unstage-${c.path}`} />
      ) : (
        <>
          {c.code !== 'UU' && <IconButton icon="rotate-ccw" label={`Discard ${c.path}`} onPress={() => confirmDiscard(c)} testID={`gp-discard-${c.path}`} />}
          <IconButton icon="plus" label={`Stage ${c.path}`} onPress={() => act(() => git.stage([c.path]))} testID={`gp-stage-${c.path}`} />
        </>
      )}
    </Pressable>
  );

  async function commit() {
    if (await act(() => git.commit(message.trim()))) setMessage('');
  }

  return (
    <View style={styles.gap}>
      {status.merging && (
        <View style={styles.banner} testID="gp-merging">
          <Icon name="git-merge" size={16} color={colors.warning} />
          <Text style={styles.flex}>
            {status.merging}. {conflicts.length ? 'Resolve the conflicts in the editor, then stage each file.' : 'Commit to finish the merge.'}
          </Text>
          <Button title="Abort" variant="outline" onPress={() => act(() => git.abortMerge(), true)} disabled={busy} testID="gp-abort-merge" />
        </View>
      )}

      <View style={styles.sectionHead}>
        <Text variant="label" style={styles.flex}>
          Staged changes ({staged.length})
        </Text>
        {staged.length > 0 && (
          <IconButton icon="minus-circle" label="Unstage all" onPress={() => act(() => git.unstage(staged.map((c) => c.path)))} testID="gp-unstage-all" />
        )}
      </View>
      {staged.length === 0 && <Text variant="muted">Nothing staged. Tap + on a file, or open it to stage single changes.</Text>}
      {staged.map((c) => row(c, 'staged'))}

      <View style={styles.sectionHead}>
        <Text variant="label" style={styles.flex}>
          Changes ({unstaged.length})
        </Text>
        {unstaged.length > 0 && (
          <IconButton
            icon="plus-circle"
            label="Stage all"
            onPress={() => act(() => git.stage(unstaged.filter((c) => c.code !== 'UU').map((c) => c.path)))}
            testID="gp-stage-all"
          />
        )}
      </View>
      {unstaged.length === 0 && <Text variant="muted">No changes since the last commit.</Text>}
      {unstaged.map((c) => row(c, 'unstaged'))}

      <TextInput
        testID="gp-message"
        value={message}
        onChangeText={setMessage}
        placeholder={status.merging ?? 'Commit message'}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.brand}
        multiline
        style={styles.input}
      />
      <SuggestMessageButton
        changes={() => changedFiles(ctx.project, staged.map((c) => c.path), 'index')}
        onMessage={setMessage}
        disabled={busy || staged.length === 0}
        testID="gp-suggest"
      />
      <View style={styles.actions}>
        <Button title="Pull" variant="outline" icon="download" onPress={() => act(() => trackGit(ctx.project, 'pull', () => git.pull()), true)} disabled={busy} testID="gp-pull" />
        <Button title="Push" variant="outline" icon="upload" onPress={() => act(() => trackGit(ctx.project, 'push', () => git.push()))} disabled={busy} testID="gp-push" />
        <Button
          title={`Commit${staged.length ? ` ${staged.length}` : ''}`}
          icon="check"
          onPress={() => {
            if (!message.trim() && status.merging) setMessage(status.merging);
            else commit();
          }}
          disabled={busy || (!message.trim() && !status.merging) || (staged.length === 0 && !status.merging)}
          testID="gp-commit"
        />
      </View>
      <Stashes {...{ git, act, busy, setDetail, ctx, status }} dirty={status.changes.length > 0} />
    </View>
  );
}

// Tells the user what a cherry-pick or rebase result means for them.
export function explainPick(r: PickResult, what: string): string | null {
  if (r.status === 'conflict') return `${r.current.subject} conflicts in ${r.conflicts.join(', ')}. Resolve them in the editor, stage each file, then Continue.`;
  if (r.status === 'empty') return `${r.current.subject} changes nothing here: the branch already has it.`;
  if (r.status === 'done' && r.skipped.length) return `${what} finished. Left out because their changes were already there: ${r.skipped.map((s) => s.subject).join(', ')}.`;
  return null;
}

// While a rebase or cherry-pick waits: what it's doing, and Continue / Skip / Abort.
function OperationBanner({ git, act, busy, setTab, status }: Shared & { status: Status }) {
  const styles = useStyles();
  const colors = useColors();
  const op = status.operation!;
  const conflicts = status.changes.filter((c) => c.code === 'UU');
  const rebase = op.kind === 'rebase';
  const step = (run: () => Promise<PickResult | null>) =>
    act(async () => {
      const r = await run();
      const note = r && explainPick(r, rebase ? 'Rebase' : 'Cherry-pick');
      if (note) Alert.alert(rebase ? 'Rebase' : 'Cherry-pick', note);
      if (r?.status === 'conflict') setTab('changes');
    }, true);
  const title = rebase
    ? `Rebasing ${op.branch} onto ${op.onto.slice(0, 7)} (${op.step}/${op.total})${op.current ? `, stopped at ${op.current.subject}` : ''}.`
    : `Cherry-picking ${op.current.oid.slice(0, 7)} ${op.current.subject}.`;
  return (
    <View style={[styles.banner, styles.operation]} testID="gp-operation">
      <View style={styles.bannerHead}>
        <Icon name={rebase ? 'git-pull-request' : 'git-commit'} size={16} color={colors.warning} />
        <Text style={styles.flex}>
          {title} {conflicts.length ? `Resolve ${conflicts.map((c) => c.path).join(', ')} in the editor, then stage each file.` : 'Stage the resolved files, then Continue.'}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Abort" variant="outline" onPress={() => step(() => (rebase ? git.rebaseAbort() : git.cherryPickAbort()))} disabled={busy} testID="gp-op-abort" />
        {rebase && <Button title="Skip" variant="outline" onPress={() => step(() => git.rebaseSkip())} disabled={busy} testID="gp-op-skip" />}
        <Button
          title="Continue"
          icon="check"
          onPress={() => step(() => (rebase ? git.rebaseContinue() : git.cherryPickContinue()))}
          disabled={busy || conflicts.length > 0}
          testID="gp-op-continue"
        />
      </View>
    </View>
  );
}

function Stashes({ git, act, busy, setDetail, status, dirty }: Omit<Shared, 'setTab' | 'refresh'> & { status: Status; dirty: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const [list, setList] = useState<StashEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    git.stashes().then(setList, () => setList([]));
  }, [git, status]);

  const applied = (r: { conflicts: string[] }, popped: boolean) => {
    if (r.conflicts.length)
      Alert.alert('Stash conflicts', `Resolve the conflicts in ${r.conflicts.join(', ')} and stage the files.${popped ? ' The stash was kept.' : ''}`);
  };
  const drop = (s: StashEntry) =>
    Alert.alert(`Drop ${s.message}?`, 'The stashed changes will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Drop', style: 'destructive', onPress: () => act(() => git.stashDrop(s.index)) },
    ]);

  return (
    <View style={styles.gap}>
      <View style={styles.sectionHead}>
        <Text variant="label" style={styles.flex}>
          Stashes ({list?.length ?? 0})
        </Text>
        <IconButton icon="archive" label="Stash changes" onPress={() => setSaving(true)} disabled={busy || !dirty} testID="gp-stash-save" />
      </View>
      {list?.length === 0 && <Text variant="muted">Stash puts your changes aside and leaves the files as they were at the last commit.</Text>}
      {list?.map((s) => (
        <Pressable
          accessibilityRole="button"
          key={s.oid}
          testID={`gp-stash-${s.index}`}
          onPress={() => setDetail({ kind: 'commit', stash: true, commit: { oid: s.oid, message: s.message, author: 'stash', timestamp: s.timestamp, parents: s.parents.slice(0, 1) } })}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
        >
          <Icon name="archive" size={16} color={colors.mutedForeground} />
          <View style={styles.flex}>
            <Text numberOfLines={1}>{s.message}</Text>
            <Text variant="muted">
              stash@{'{'}
              {s.index}
              {'}'} · {ago(s.timestamp)}
            </Text>
          </View>
          <IconButton icon="corner-down-left" label={`Apply ${s.message}`} onPress={() => act(() => git.stashApply(s.index).then((r) => applied(r, false)), true)} testID={`gp-stash-apply-${s.index}`} />
          <IconButton icon="download" label={`Pop ${s.message}`} onPress={() => act(() => git.stashPop(s.index).then((r) => applied(r, true)), true)} testID={`gp-stash-pop-${s.index}`} />
          <IconButton icon="trash-2" label={`Drop ${s.message}`} onPress={() => drop(s)} testID={`gp-stash-drop-${s.index}`} />
        </Pressable>
      ))}
      <FormSheet
        visible={saving}
        title="Stash changes"
        description="Your changes are saved aside and the files go back to the last commit."
        confirmLabel="Stash"
        fields={[
          { key: 'message', label: 'Message', placeholder: 'What you were doing (optional)' },
          {
            key: 'untracked',
            label: 'New files',
            choices: [
              { value: '1', label: 'Include' },
              { value: '0', label: 'Leave' },
            ],
          },
        ]}
        onClose={() => setSaving(false)}
        onSubmit={async (v) => {
          if (!(await act(() => git.stashPush(v.message.trim(), v.untracked === '1'), true))) throw new Error('Could not stash the changes');
        }}
      />
    </View>
  );
}

// One file's changes, staged (HEAD -> index) or not (index -> working tree), with per-hunk actions.
function FileDiff({ git, act, busy, ctx, path, staged }: Shared & { path: string; staged: boolean }) {
  const styles = useStyles();
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof git.show>> | null>(null);
  const load = useCallback(() => git.show(path).then(setVersions, () => setVersions({ binary: true })), [git, path]);
  useEffect(() => {
    load();
  }, [load]);

  if (!versions) return <Text variant="muted">Loading...</Text>;
  if (versions.binary) return <Text variant="muted">Binary file: no text diff.</Text>;
  const before = (staged ? versions.head : versions.index) ?? '';
  const after = (staged ? versions.index : versions.work) ?? '';
  const hunks = diffText(before, after);

  const run = (step: () => Promise<unknown>, touchesFiles = false) => act(step, touchesFiles).then(load);
  const writeWork = async (text: string) => {
    const open = buffersStore.getState().buffers[bufferKey(ctx.project, path)];
    if (open) await buffersStore.getState().replace(ctx.project, path, text);
    else await workspace.writeFile(ctx.project, path, text);
  };
  const actions = staged
    ? [{ label: 'Unstage', run: (h: Hunk) => run(() => git.stageText(path, revertHunk(before, after, h))) }]
    : [
        {
          label: 'Discard',
          destructive: true,
          run: (h: Hunk) =>
            Alert.alert('Discard this change?', 'The lines go back to their staged or committed version.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => run(() => writeWork(revertHunk(before, after, h)), true) },
            ]),
        },
        { label: 'Stage', run: (h: Hunk) => run(() => git.stageText(path, applyHunk(before, after, h))) },
      ];

  return (
    <View style={styles.gap}>
      <View style={styles.actions}>
        <Button title="Open file" variant="outline" icon="file-text" onPress={() => ctx.openFile(path, hunks?.[0]?.newStart || 1)} testID="gp-open-file" />
      </View>
      <Text variant="muted">{staged ? 'Staged: last commit → staged' : 'Not staged: staged → working copy'}</Text>
      <DiffView hunks={hunks} actions={actions} busy={busy} empty={staged ? 'Nothing staged in this file.' : 'No unstaged changes in this file.'} />
    </View>
  );
}

function BranchList({ git, act, busy, status, setTab }: Shared & { status: Status }) {
  const styles = useStyles();
  const colors = useColors();
  const [branches, setBranches] = useState<Branches | null>(null);
  const [creating, setCreating] = useState(false);
  const [choosingBase, setChoosingBase] = useState(false);
  useEffect(() => {
    git.branches().then(setBranches, () => setBranches({ current: null, local: [], remote: [] }));
  }, [git, status]);

  if (!branches) return <Text variant="muted">Loading...</Text>;
  const dirty = status.changes.some((c) => c.code !== '??');
  const checkout = (ref: string) => {
    if (dirty) Alert.alert('Uncommitted changes', 'Commit or discard your changes before switching branches.');
    else act(() => git.checkout(ref), true);
  };
  const remove = (name: string) =>
    Alert.alert(`Delete ${name}?`, 'Commits only on this branch will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => act(() => git.deleteBranch(name)) },
    ]);
  const merge = (name: string) =>
    Alert.alert(`Merge ${name} into ${branches.current}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Merge',
        onPress: () =>
          act(async () => {
            const r = await git.merge(name);
            if (r.conflicts.length) Alert.alert('Merge conflicts', `Resolve the conflicts in ${r.conflicts.join(', ')}, stage the files and commit.`);
          }, true),
      },
    ]);

  const rebaseOnto = (onto: string) =>
    Alert.alert(`Rebase ${branches.current} onto ${onto}?`, `Your commits on ${branches.current} are replayed one by one on top of ${onto}. Their ids change.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Rebase',
        onPress: () =>
          act(async () => {
            const r = await git.rebase(onto);
            if (r.status === 'up-to-date') Alert.alert('Rebase', `${branches.current} already has everything in ${onto}.`);
            const note = explainPick(r, 'Rebase');
            if (note) Alert.alert('Rebase', note);
            if (r.status === 'conflict') setTab('changes');
          }, true),
      },
    ]);
  const bases = [...branches.local.filter((b) => b !== branches.current), ...branches.remote];

  return (
    <View style={styles.gap}>
      <View style={styles.actions}>
        <Button
          title="Rebase onto…"
          variant="outline"
          icon="git-pull-request"
          onPress={() => {
            if (dirty) Alert.alert('Uncommitted changes', 'Commit or stash your changes before rebasing.');
            else setChoosingBase(true);
          }}
          disabled={busy || !branches.current || !bases.length || !!status.operation}
          testID="gp-rebase"
        />
        <Button title="New branch" variant="outline" icon="plus" onPress={() => setCreating(true)} disabled={busy} testID="gp-new-branch" />
      </View>
      <Text variant="label">Local</Text>
      {branches.local.map((b) => {
        const current = b === branches.current;
        return (
          <Pressable accessibilityRole="button"
            key={b}
            testID={`gp-branch-${b}`}
            onPress={() => !current && checkout(b)}
            style={({ pressed }) => [styles.row, pressed && !current && { backgroundColor: colors.secondary }]}
          >
            <Icon name={current ? 'check' : 'git-branch'} size={16} color={current ? colors.success : colors.mutedForeground} />
            <Text style={styles.flex} numberOfLines={1}>
              {b}
            </Text>
            {!current && (
              <>
                <IconButton icon="git-merge" label={`Merge ${b}`} onPress={() => merge(b)} testID={`gp-merge-${b}`} />
                <IconButton icon="trash-2" label={`Delete ${b}`} onPress={() => remove(b)} testID={`gp-delete-${b}`} />
              </>
            )}
          </Pressable>
        );
      })}
      {branches.remote.length > 0 && <Text variant="label">Remote</Text>}
      {branches.remote.map((b) => (
        <Pressable accessibilityRole="button" key={b} testID={`gp-remote-${b}`} onPress={() => checkout(b)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}>
          <Icon name="cloud" size={16} color={colors.mutedForeground} />
          <Text style={styles.flex} numberOfLines={1}>
            {b}
          </Text>
          <IconButton icon="git-merge" label={`Merge ${b}`} onPress={() => merge(b)} />
        </Pressable>
      ))}
      <Tags git={git} act={act} busy={busy} status={status} />
      <ActionSheet
        title={choosingBase ? `Rebase ${branches.current} onto` : null}
        actions={bases.map((b) => ({ label: b, icon: branches.remote.includes(b) ? 'cloud' : 'git-branch', onPress: () => rebaseOnto(b) }))}
        onClose={() => setChoosingBase(false)}
      />
      <PromptSheet
        visible={creating}
        title="New branch from the current commit"
        placeholder="feature/name"
        confirmLabel="Create and switch"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          if (!/^[\w./-]+$/.test(name) || name.includes('..')) throw new Error('Use letters, numbers, dots, dashes and slashes');
          if (!(await act(() => git.createBranch(name), true))) throw new Error('Could not create the branch');
        }}
      />
    </View>
  );
}

function Tags({ git, act, busy, status }: Pick<Shared, 'git' | 'act' | 'busy'> & { status: Status }) {
  const styles = useStyles();
  const colors = useColors();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => git.tags().then(setTags, () => setTags([])), [git]);
  useEffect(() => {
    load();
  }, [load, status]);
  const run = (step: () => Promise<unknown>) => act(step).then(load);
  const remove = (t: Tag) =>
    Alert.alert(`Delete tag ${t.name}?`, 'Only the local tag is deleted; a pushed one stays on the remote.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run(() => git.deleteTag(t.name)) },
    ]);
  return (
    <View style={styles.gap}>
      <View style={styles.sectionHead}>
        <Text variant="label" style={styles.flex}>
          Tags
        </Text>
        <IconButton icon="plus" label="New tag" onPress={() => setCreating(true)} disabled={busy} testID="gp-new-tag" />
      </View>
      {tags?.length === 0 && <Text variant="muted">No tags. A tag names a commit, such as a release.</Text>}
      {tags?.map((t) => (
        <View key={t.name} style={styles.row} testID={`gp-tag-${t.name}`}>
          <Icon name="tag" size={16} color={colors.mutedForeground} />
          <View style={styles.flex}>
            <Text numberOfLines={1}>{t.name}</Text>
            <Text variant="muted" numberOfLines={1}>
              {t.oid.slice(0, 7)}
              {t.message ? ` · ${t.message.split('\n')[0]}` : ''}
            </Text>
          </View>
          <IconButton icon="upload" label={`Push ${t.name}`} onPress={() => run(() => git.pushTag(t.name))} testID={`gp-tag-push-${t.name}`} />
          <IconButton icon="trash-2" label={`Delete ${t.name}`} onPress={() => remove(t)} testID={`gp-tag-delete-${t.name}`} />
        </View>
      ))}
      <FormSheet
        visible={creating}
        title="New tag on the current commit"
        confirmLabel="Create tag"
        fields={[
          { key: 'name', label: 'Name', placeholder: 'v1.0.0', required: true, mono: true },
          { key: 'message', label: 'Message', placeholder: 'Optional; makes an annotated tag', multiline: true },
        ]}
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          const name = v.name.trim();
          if (!/^[\w./-]+$/.test(name) || name.includes('..')) throw new Error('Use letters, numbers, dots, dashes and slashes');
          if (!(await act(() => git.createTag(name, v.message.trim())))) throw new Error('Could not create the tag');
          await load();
        }}
      />
    </View>
  );
}

function History({ git, setDetail }: Shared) {
  const styles = useStyles();
  const colors = useColors();
  const [log, setLog] = useState<CommitInfo[] | null>(null);
  useEffect(() => {
    git.log(100).then(setLog, () => setLog([]));
  }, [git]);
  if (!log) return <Text variant="muted">Loading...</Text>;
  if (!log.length) return <Text variant="muted">No commits yet.</Text>;
  return (
    <View>
      {log.map((c) => (
        <Pressable accessibilityRole="button"
          key={c.oid}
          testID={`gp-commit-${c.oid.slice(0, 7)}`}
          onPress={() => setDetail({ kind: 'commit', commit: c })}
          style={({ pressed }) => [styles.commit, pressed && { backgroundColor: colors.secondary }]}
        >
          <View style={[styles.dot, c.parents.length > 1 && { backgroundColor: colors.brand }]} />
          <View style={styles.flex}>
            <Text numberOfLines={2}>{c.message.split('\n')[0]}</Text>
            <Text variant="muted">
              {c.oid.slice(0, 7)} · {c.author} · {ago(c.timestamp)}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function CommitDetail({ git, act, busy, setDetail, setTab, commit, stash }: Shared & { commit: CommitInfo; stash: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const cherryPick = () =>
    Alert.alert('Cherry-pick this commit?', 'Its changes are applied on top of the current branch as a new commit.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Cherry-pick',
        onPress: () =>
          act(async () => {
            const r = await git.cherryPick(commit.oid);
            const note = explainPick(r, 'Cherry-pick');
            if (note) Alert.alert('Cherry-pick', note);
            setDetail(null);
            setTab(r.status === 'conflict' ? 'changes' : 'history');
          }, true),
      },
    ]);
  const [files, setFiles] = useState<Awaited<ReturnType<typeof git.commitFiles>> | null>(null);
  useEffect(() => {
    git.commitFiles(commit.oid).then(setFiles, () => setFiles([]));
  }, [git, commit.oid]);
  return (
    <View style={styles.gap}>
      <Text variant="mono" style={styles.message}>
        {commit.message}
      </Text>
      <Text variant="muted">
        {commit.oid.slice(0, 7)} · {commit.author} · {new Date(commit.timestamp * 1000).toLocaleString()}
        {commit.parents.length > 1 ? ' · merge commit' : ''}
      </Text>
      {!stash && commit.parents.length === 1 && (
        <View style={styles.actions}>
          <Button title="Cherry-pick this commit" variant="outline" icon="git-commit" onPress={cherryPick} disabled={busy} testID="gp-cherry-pick" />
        </View>
      )}
      {!files && <Text variant="muted">Loading...</Text>}
      {files?.map((f) => (
        <Pressable accessibilityRole="button"
          key={f.path}
          testID={`gp-commit-file-${f.path}`}
          onPress={() => setDetail({ kind: 'commitFile', commit, path: f.path })}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondary }]}
        >
          <Text variant="mono" numberOfLines={1} style={styles.flex}>
            {f.path}
          </Text>
          <Text variant="muted" style={{ color: f.status === 'added' ? colors.success : f.status === 'deleted' ? colors.destructive : colors.warning }}>
            {f.status}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function CommitFileDiff({ git, commit, path }: Shared & { commit: CommitInfo; path: string }) {
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof git.commitFile>> | null>(null);
  useEffect(() => {
    git.commitFile(commit.oid, path).then(setVersions, () => setVersions({ binary: true }));
  }, [git, commit.oid, path]);
  if (!versions) return <Text variant="muted">Loading...</Text>;
  if (versions.binary) return <Text variant="muted">Binary file: no text diff.</Text>;
  return <DiffView hunks={diffText(versions.before ?? '', versions.after ?? '')} />;
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
  },
  title: { flex: 1 },
  branch: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: spacing.sm },
  tabs: { padding: spacing.sm },
  content: { padding: spacing.md },
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.destructiveSoft,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.warningSoft },
  operation: { flexDirection: 'column', alignItems: 'stretch', marginBottom: spacing.md },
  bannerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  input: {
    minHeight: 44,
    maxHeight: 120,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontFamily: fonts.sans.regular,
    fontSize: fontSizes.md,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  commit: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  dot: { width: 10, height: 10, marginTop: 6, borderRadius: 5, backgroundColor: colors.mutedForeground },
  message: { fontSize: fontSizes.sm, lineHeight: 20 },
}));
