import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput } from 'react-native';

import { Empty, ListRow, Loading, Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { useAsync } from '../../components/useAsync';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fontSizes, radius, spacing } from '../../theme/tokens';
import { timeAgo } from '../github/api';
import { apiFor, HOST_LABEL, useAccounts } from './accounts';

// The repositories an account can reach, most recently active first.
export function HostReposScreen() {
  const { account } = useLocalSearchParams<{ account: string }>();
  const styles = useStyles();
  const colors = useColors();
  const a = useAccounts((s) => s.accounts.find((x) => x.id === account));
  const repos = useAsync(() => apiFor(account).repos(), [account]);
  const [filter, setFilter] = useState('');
  const shown = (repos.value ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Screen title={a ? HOST_LABEL[a.kind] : 'Repositories'} subtitle={a?.username} onRefresh={repos.reload} refreshing={repos.loading && !!repos.value} testID="host-repos">
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Filter repositories"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.filter}
        testID="host-repos-filter"
      />
      {repos.error && <Text variant="error">{repos.error}</Text>}
      {repos.loading && !repos.value && <Loading />}
      {repos.value?.length === 0 && <Empty title="No repositories" body="This account isn't a member of any repositories yet." />}
      {shown.map((r) => (
        <ListRow
          key={r.id}
          icon={r.private ? 'lock' : 'book'}
          title={r.fullName}
          subtitle={r.description || undefined}
          detail={r.updatedAt ? `Updated ${timeAgo(r.updatedAt)}` : undefined}
          onPress={() => router.push({ pathname: '/hosts/repo', params: { account, repo: r.id, name: r.fullName, clone: r.cloneUrl, web: r.webUrl } })}
          testID={`host-repo-${r.fullName}`}
        />
      ))}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  filter: {
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontSize: fontSizes.md,
  },
}));
