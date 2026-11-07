import { router } from 'expo-router';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, TextInput, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { accountStore, github, useAccount } from './account';
import { Issue, Repo, repoOf, timeAgo } from './api';
import { SignIn } from './SignIn';

type Tab = 'repos' | 'pulls' | 'issues';

export const repoHref = (owner: string, repo: string) => ({ pathname: '/github/repo', params: { owner, repo } }) as const;
export const itemHref = (owner: string, repo: string, number: number, pull: boolean) =>
  ({ pathname: pull ? '/github/pull' : '/github/issue', params: { owner, repo, number: String(number) } }) as const;

// GitHub: your repositories, and the open pull requests and issues you're part of.
export function GitHubHome() {
  const user = useAccount((s) => s.user);
  const checking = useAccount((s) => s.checking);
  const [tab, setTab] = useState<Tab>('repos');

  useEffect(() => {
    if (!user) accountStore.getState().refresh();
  }, [user]);

  if (!user) {
    return (
      <Screen title="GitHub" testID="github">
        {checking ? <Loading /> : <SignIn />}
      </Screen>
    );
  }
  return (
    <Screen
      title="GitHub"
      subtitle={`Signed in as ${user.login}`}
      scroll={false}
      testID="github"
      actions={<IconButton icon="settings" label="Account" onPress={() => router.push('/github/account')} testID="github-account" />}
    >
      <View style={{ padding: spacing.sm }}>
        <Segmented<Tab>
          testID="github-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'repos', label: 'Repositories' },
            { value: 'pulls', label: 'Pull requests' },
            { value: 'issues', label: 'Issues' },
          ]}
        />
      </View>
      {tab === 'repos' ? <Repos /> : <Involved login={user.login} kind={tab === 'pulls' ? 'pr' : 'issue'} />}
    </Screen>
  );
}

function Repos() {
  const styles = useStyles();
  const colors = useColors();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<Repo[] | null>(null);
  const mine = useAsync(() => github().repos(), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (mine.value ?? []).filter((r) => !q || r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
  }, [mine.value, query]);
  const list = searched ?? filtered;

  return (
    <List onRefresh={mine.reload} refreshing={mine.loading}>
      <TextInput
        testID="github-search"
        value={query}
        onChangeText={(q) => {
          setQuery(q);
          setSearched(null);
        }}
        placeholder="Filter your repositories"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => query.trim() && github().searchRepos(query.trim()).then(setSearched)}
        selectionColor={colors.brand}
        style={styles.search}
      />
      {query.trim() !== '' && !searched && (
        <Button title={`Search all of GitHub for “${query.trim()}”`} variant="outline" icon="search" onPress={() => github().searchRepos(query.trim()).then(setSearched)} />
      )}
      {mine.error && <Text variant="error">{mine.error}</Text>}
      {mine.loading && !mine.value && <Loading />}
      {mine.value && list.length === 0 && <Empty title="No repositories" body={query ? 'Nothing matches that.' : undefined} />}
      {list.map((r) => (
        <ListRow
          key={r.id}
          icon={r.private ? 'lock' : r.fork ? 'git-branch' : 'book'}
          title={r.full_name}
          subtitle={r.description ?? undefined}
          detail={[r.language, `★ ${r.stargazers_count}`, `updated ${timeAgo(r.updated_at)}`].filter(Boolean).join(' · ')}
          onPress={() => router.push(repoHref(r.owner.login, r.name))}
          testID={`repo-${r.full_name}`}
        />
      ))}
    </List>
  );
}

function Involved({ login, kind }: { login: string; kind: 'pr' | 'issue' }) {
  const colors = useColors();
  const items = useAsync(() => github().involved(login, kind), [login, kind]);
  return (
    <List onRefresh={items.reload} refreshing={items.loading}>
      {items.error && <Text variant="error">{items.error}</Text>}
      {items.loading && !items.value && <Loading />}
      {items.value?.length === 0 && <Empty title={kind === 'pr' ? 'No open pull requests' : 'No open issues'} body="Ones you opened, were assigned or mentioned in show up here." />}
      {items.value?.map((i: Issue) => {
        const r = repoOf(i);
        return (
          <ListRow
            key={`${i.repository_url}#${i.number}`}
            icon={kind === 'pr' ? 'git-pull-request' : 'circle'}
            iconColor={colors.success}
            title={i.title}
            subtitle={`${r ? `${r.owner}/${r.repo}` : ''} #${i.number}`}
            detail={`by ${i.user.login} · updated ${timeAgo(i.updated_at)}`}
            onPress={() => r && router.push(itemHref(r.owner, r.repo, i.number, kind === 'pr'))}
          />
        );
      })}
    </List>
  );
}

// A refreshable list body under a screen's own header.
export function List({ children, onRefresh, refreshing }: { children: ReactNode; onRefresh(): void; refreshing: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <ScrollView
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.mutedForeground} />}
    >
      {children}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { padding: spacing.sm, paddingTop: 0, gap: spacing.sm, paddingBottom: spacing.xl },
  search: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontSize: fontSizes.md,
  },
}));
