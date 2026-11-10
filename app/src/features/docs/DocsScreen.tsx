import { Icon } from '../../components/Icon';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { docs } from '.';
import type { DocEntry, DocInfo, InstalledDoc } from './docs';

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const label = (d: DocInfo) => `${d.name}${d.release ? ` ${d.release}` : d.version ? ` ${d.version}` : ''}`;

// Docs you download once and read offline: search across them, or get more.
export function DocsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const [installed, setInstalled] = useState<InstalledDoc[] | null>(null);
  const [available, setAvailable] = useState<DocInfo[] | null>(null);
  const [offline, setOffline] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');
  const [results, setResults] = useState<(DocEntry & { slug: string })[]>([]);

  const refresh = useCallback(() => docs.installed().then(setInstalled, () => setInstalled([])), []);
  useEffect(() => {
    refresh();
    docs.available().then(setAvailable, (e: Error) => setOffline(e.message));
  }, [refresh]);

  useEffect(() => {
    if (!installed?.length || !query.trim()) return setResults([]);
    let cancelled = false;
    const timer = setTimeout(() => {
      docs.search(installed.map((d) => d.slug), query).then((r) => !cancelled && setResults(r), () => undefined);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [installed, query]);

  const install = async (d: DocInfo) => {
    setBusy((b) => ({ ...b, [d.slug]: 'Getting the index…' }));
    try {
      await docs.install(d, (step) => setBusy((b) => ({ ...b, [d.slug]: step === 'index' ? 'Getting the index…' : `Downloading ${mb(d.db_size)}…` })));
      await refresh();
    } catch (e) {
      Alert.alert(`Couldn't download ${d.name}`, e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(({ [d.slug]: _done, ...rest }) => rest);
    }
  };
  const remove = (d: InstalledDoc) =>
    Alert.alert(`Remove ${d.name}?`, 'You can download it again later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => docs.remove(d.slug).then(refresh) },
    ]);
  const nameOf = (slug: string) => installed?.find((d) => d.slug === slug)?.name ?? slug;
  const notInstalled = (available ?? []).filter((d) => !installed?.some((i) => i.name === d.name && i.slug === d.slug));

  return (
    <Screen title="Docs" subtitle="Offline, from DevDocs" testID="docs">
      <View style={styles.search}>
        <Icon name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={installed?.length ? 'Search your docs' : 'Download a doc below to search it'}
          placeholderTextColor={colors.mutedForeground}
          editable={!!installed?.length}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          testID="docs-search"
        />
      </View>

      {query.trim() && installed?.length ? (
        <>
          {results.length === 0 && <Text variant="muted">Nothing found for “{query.trim()}”.</Text>}
          {results.map((r, i) => (
            <Pressable
              key={`${r.slug}:${r.path}:${i}`}
              onPress={() => router.push({ pathname: '/docs/page', params: { slug: r.slug, path: r.path } })}
              accessibilityRole="button"
              style={styles.row}
              testID={`docs-result-${i}`}
            >
              <View style={styles.flex}>
                <Text variant="mono" numberOfLines={1}>
                  {r.name}
                </Text>
                <Text variant="muted" numberOfLines={1}>
                  {nameOf(r.slug)} · {r.type}
                </Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <Text variant="label">On this device</Text>
          {installed === null && <ActivityIndicator color={colors.mutedForeground} />}
          {installed?.length === 0 && <Text variant="muted">No docs yet. Download the ones you use; they work without a connection after that.</Text>}
          {installed?.map((d) => (
            <View key={d.slug} style={styles.row} testID={`docs-installed-${d.slug}`}>
              <Icon name="book" size={16} color={colors.brand} />
              <View style={styles.flex}>
                <Text variant="label">{label(d)}</Text>
                <Text variant="muted">
                  {d.entries.toLocaleString('en-US')} entries · {mb(d.db_size)}
                </Text>
              </View>
              <Pressable onPress={() => remove(d)} accessibilityRole="button" accessibilityLabel={`Remove ${d.name}`} hitSlop={8}>
                <Icon name="trash-2" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}

          <Text variant="label">Download</Text>
          {offline && <Text variant="muted">The list of docs needs a connection to DevDocs ({offline}).</Text>}
          {!offline && available === null && <ActivityIndicator color={colors.mutedForeground} />}
          {notInstalled.map((d) => (
            <View key={d.slug} style={styles.row} testID={`docs-available-${d.slug}`}>
              <View style={styles.flex}>
                <Text variant="label">{label(d)}</Text>
                <Text variant="muted">{busy[d.slug] ?? mb(d.db_size)}</Text>
              </View>
              {busy[d.slug] ? <ActivityIndicator color={colors.mutedForeground} /> : <Button title="Download" variant="outline" icon="download" onPress={() => install(d)} testID={`docs-download-${d.slug}`} />}
            </View>
          ))}
          <Text variant="muted">Documentation is from DevDocs (devdocs.io), under each project's own license, shown at the end of its pages.</Text>
        </>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((colors) => ({
  flex: { flex: 1, gap: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm + 2, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  input: { flex: 1, height: 44, color: colors.foreground },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm + 2, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
}));
