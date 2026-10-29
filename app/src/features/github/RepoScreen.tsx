import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Badge, Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import { cloneRepo } from '../git/clone';
import { projectHref } from '../projects/href';
import { github } from './account';
import { timeAgo, WorkflowRun } from './api';
import { itemHref, List } from './GitHubHome';

type Tab = 'pulls' | 'issues' | 'actions';

export function runColor(run: { status: string | null; conclusion: string | null }, colors: ReturnType<typeof useColors>) {
  if (run.status !== 'completed') return colors.warning;
  if (run.conclusion === 'success') return colors.success;
  if (run.conclusion === 'skipped' || run.conclusion === 'cancelled' || run.conclusion === 'neutral') return colors.mutedForeground;
  return colors.destructive;
}

export function runLabel(run: { status: string | null; conclusion: string | null }) {
  if (run.status !== 'completed') return run.status === 'queued' ? 'Queued' : 'Running';
  return (run.conclusion ?? 'done').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// One repository: its pull requests, issues and Actions runs, and Clone.
export function RepoScreen() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const colors = useColors();
  const [tab, setTab] = useState<Tab>('pulls');
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [form, setForm] = useState<'issue' | 'pull' | null>(null);
  const [cloning, setCloning] = useState(false);
  const info = useAsync(() => github().repo(owner, repo), [owner, repo]);
  const list = useAsync<unknown[]>(
    () => (tab === 'pulls' ? github().pulls(owner, repo, state) : tab === 'issues' ? github().issues(owner, repo, state) : github().runs(owner, repo)),
    [owner, repo, tab, state],
  );
  const branches = useAsync(() => (form === 'pull' ? github().branches(owner, repo) : Promise.resolve([])), [form, owner, repo]);

  const clone = async () => {
    if (!info.value) return;
    setCloning(true);
    try {
      const project = await cloneRepo(repo, info.value.clone_url);
      haptic('success');
      router.push(projectHref(project));
    } catch (e) {
      haptic('error');
      Alert.alert('Clone failed', e instanceof Error ? e.message : String(e));
    } finally {
      setCloning(false);
    }
  };

  const rerun = (run: WorkflowRun) =>
    Alert.alert(`Re-run “${run.display_title}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Re-run',
        onPress: () =>
          github()
            .rerun(owner, repo, run.id)
            .then(() => {
              haptic('success');
              list.reload();
            })
            .catch((e) => Alert.alert('Re-run failed', String(e?.message ?? e))),
      },
    ]);

  return (
    <Screen
      title={repo}
      subtitle={owner}
      scroll={false}
      testID="github-repo"
      actions={
        <>
          <IconButton icon="external-link" label="Open on GitHub" onPress={() => info.value && Linking.openURL(info.value.html_url)} />
          {tab !== 'actions' && <IconButton icon="plus" label={tab === 'pulls' ? 'New pull request' : 'New issue'} onPress={() => setForm(tab === 'pulls' ? 'pull' : 'issue')} testID="github-new" />}
        </>
      }
    >
      <View style={{ padding: spacing.sm, gap: spacing.sm }}>
        {info.value?.description ? <Text variant="muted">{info.value.description}</Text> : null}
        <Button title={cloning ? 'Cloning…' : 'Clone into a project'} icon="download" onPress={clone} disabled={cloning || !info.value} testID="github-clone" />
        <Segmented<Tab>
          testID="repo-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pulls', label: 'Pull requests' },
            { value: 'issues', label: 'Issues' },
            { value: 'actions', label: 'Actions' },
          ]}
        />
        {tab !== 'actions' && (
          <Segmented<'open' | 'closed'>
            value={state}
            onChange={setState}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        )}
      </View>
      <List onRefresh={list.reload} refreshing={list.loading}>
        {list.error && <Text variant="error">{list.error}</Text>}
        {list.loading && !list.value && <Loading />}
        {list.value?.length === 0 && <Empty title={tab === 'actions' ? 'No workflow runs' : `No ${state} ${tab === 'pulls' ? 'pull requests' : 'issues'}`} />}
        {tab === 'actions'
          ? (list.value as WorkflowRun[] | null)?.map((run) => (
              <ListRow
                key={run.id}
                icon={run.status === 'completed' ? (run.conclusion === 'success' ? 'check-circle' : 'x-circle') : 'loader'}
                iconColor={runColor(run, colors)}
                title={run.display_title}
                subtitle={`${run.name ?? 'Workflow'} #${run.run_number} · ${run.head_branch ?? ''} · ${run.event}`}
                detail={`${runLabel(run)} · ${timeAgo(run.created_at)}`}
                right={<IconButton icon="rotate-cw" label="Re-run" onPress={() => rerun(run)} />}
                onPress={() => Linking.openURL(run.html_url)}
              />
            ))
          : (list.value as { number: number; title: string; user: { login: string }; updated_at: string; draft?: boolean; labels?: { name: string }[] }[] | null)?.map((i) => (
              <ListRow
                key={i.number}
                icon={tab === 'pulls' ? 'git-pull-request' : state === 'open' ? 'circle' : 'check-circle'}
                iconColor={state === 'open' ? colors.success : colors.mutedForeground}
                title={i.title}
                subtitle={`#${i.number} by ${i.user.login} · updated ${timeAgo(i.updated_at)}`}
                right={i.draft ? <Badge label="Draft" /> : undefined}
                detail={i.labels?.map((l) => l.name).join(' · ') || undefined}
                onPress={() => router.push(itemHref(owner, repo, i.number, tab === 'pulls'))}
              />
            ))}
      </List>
      <FormSheet
        visible={form === 'issue'}
        title="New issue"
        confirmLabel="Create issue"
        fields={[
          { key: 'title', label: 'Title', required: true },
          { key: 'body', label: 'Description', multiline: true, placeholder: 'Markdown is supported' },
        ]}
        onClose={() => setForm(null)}
        onSubmit={async ({ title, body }) => {
          const issue = await github().createIssue(owner, repo, title.trim(), body);
          haptic('success');
          setForm(null);
          router.push(itemHref(owner, repo, issue.number, false));
        }}
      />
      <FormSheet
        visible={form === 'pull' && !!branches.value}
        title="New pull request"
        description="Push your branch first (Source control, or git push in the terminal)."
        confirmLabel="Create pull request"
        fields={[
          { key: 'head', label: 'From branch', choices: (branches.value ?? []).filter((b) => b.name !== info.value?.default_branch).map((b) => ({ value: b.name, label: b.name })), required: true },
          { key: 'base', label: 'Into', choices: (branches.value ?? []).map((b) => ({ value: b.name, label: b.name })).sort((a) => (a.value === info.value?.default_branch ? -1 : 1)) },
          { key: 'title', label: 'Title', required: true },
          { key: 'body', label: 'Description', multiline: true },
          { key: 'draft', label: 'Open as', choices: [{ value: 'ready', label: 'Ready for review' }, { value: 'draft', label: 'Draft' }] },
        ]}
        onClose={() => setForm(null)}
        onSubmit={async ({ head, base, title, body, draft }) => {
          const pr = await github().createPull(owner, repo, { head, base, title: title.trim(), body, draft: draft === 'draft' });
          haptic('success');
          setForm(null);
          router.push(itemHref(owner, repo, pr.number, true));
        }}
      />
    </Screen>
  );
}
