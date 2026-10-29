import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { projectsStore, useRunner, workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import {
  Action,
  commandArgs,
  commandLine,
  detectEcosystems,
  Ecosystem,
  Found,
  Installed,
  isNewer,
  latestVersion,
  npmInstalled,
  pipInstalled,
  searchNpm,
  searchPip,
} from './packages';
import { runTool, tidyOutput } from './run';

const SEARCH_DELAY_MS = 350;

interface PackagesSheetProps {
  project: string;
  visible: boolean;
  onClose(): void;
  // Remote mode: the command goes to the terminal, where it runs in the container.
  onTerminal(line: string): void;
}

export function PackagesSheet({ project, visible, onClose, onTerminal }: PackagesSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const mode = useRunner((s) => s.mode);
  const [ecosystems, setEcosystems] = useState<Ecosystem[]>(['npm']);
  const [eco, setEco] = useState<Ecosystem>('npm');
  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [latest, setLatest] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    if (!visible) return;
    detectEcosystems(workspace, project).then((list) => {
      setEcosystems(list);
      setEco(list[0]);
    });
    setQuery('');
    setOutput('');
    setFailed(false);
  }, [visible, project]);

  const load = useCallback(async () => {
    const gen = ++generation.current;
    setInstalled(null);
    const list = eco === 'npm' ? await npmInstalled(workspace, project) : await pipInstalled(workspace, project);
    if (gen !== generation.current) return;
    setInstalled(list);
    // Newer versions, a few at a time so a long list doesn't flood the network.
    const queue = list.filter((p) => p.version);
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const v = await latestVersion(eco, p.name, fetch);
        if (v && gen === generation.current) setLatest((l) => ({ ...l, [`${eco}:${p!.name}`]: v }));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }, [eco, project]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  useEffect(() => {
    setFound(null);
    setSearchError(null);
    if (!query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (eco === 'npm' ? searchNpm(query.trim(), fetch) : searchPip(query.trim(), fetch)).then(
        (r) => !cancelled && setFound(r),
        (e: Error) => !cancelled && setSearchError(e.message),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, eco]);

  async function run(action: Action | { kind: 'all' }) {
    const args = action.kind === 'all' ? (eco === 'npm' ? ['install'] : ['install', '-r', 'requirements.txt']) : commandArgs(eco, action);
    if (mode === 'remote') {
      onTerminal(action.kind === 'all' ? `${eco} ${args.join(' ')}` : commandLine(eco, action));
      onClose();
      return;
    }
    setBusy(action.kind === 'all' ? '*' : action.name);
    setOutput('');
    setFailed(false);
    let text = '';
    const code = await runTool(localRunner, project, eco, args, (chunk) => {
      text += chunk;
      setOutput(tidyOutput(text));
    });
    setBusy(null);
    setFailed(code !== 0);
    haptic(code === 0 ? 'success' : 'error');
    if (code === 0) setQuery('');
    await projectsStore.getState().loadTree(project);
    await load();
  }

  const confirmRemove = (name: string) =>
    Alert.alert(`Remove ${name}?`, eco === 'npm' ? 'It is removed from package.json and node_modules.' : 'It is removed from .pylibs.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => run({ kind: 'remove', name }) },
    ]);

  const missing = installed?.filter((p) => !p.version).length ?? 0;
  const working = busy !== null;

  const renderInstalled = ({ item }: { item: Installed }) => {
    const newest = latest[`${eco}:${item.name}`];
    const update = item.version && newest && isNewer(newest, item.version) ? newest : null;
    return (
      <View style={styles.row} testID={`package-${item.name}`}>
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {item.name}
            {item.dev ? <Text variant="muted"> dev</Text> : null}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {item.version ?? 'not installed'}
            {item.wanted && item.wanted !== '*' ? `  (wants ${item.wanted})` : ''}
            {update ? `  → ${update}` : ''}
          </Text>
        </View>
        {busy === item.name ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <>
            {update && <Button title="Update" variant="outline" onPress={() => run({ kind: 'update', name: item.name })} disabled={working} testID={`update-${item.name}`} />}
            {item.version && <IconButton icon="trash-2" label={`Remove ${item.name}`} onPress={() => confirmRemove(item.name)} testID={`remove-${item.name}`} />}
          </>
        )}
      </View>
    );
  };

  const renderFound = ({ item }: { item: Found }) => {
    const have = installed?.find((p) => p.name.toLowerCase() === item.name.toLowerCase())?.version;
    return (
      <View style={styles.row} testID={`found-${item.name}`}>
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {item.name} <Text variant="muted">{item.version}</Text>
          </Text>
          {!!item.description && (
            <Text variant="muted" numberOfLines={2}>
              {item.description}
            </Text>
          )}
        </View>
        {busy === item.name ? (
          <ActivityIndicator color={colors.brand} />
        ) : have === item.version ? (
          <Text variant="muted">Installed</Text>
        ) : (
          <Button title={have ? 'Update' : 'Install'} onPress={() => run({ kind: 'install', name: item.name })} disabled={working} testID={`install-${item.name}`} />
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <IconButton icon="x" label="Close" onPress={onClose} testID="packages-close" />
          <Text variant="title" style={styles.flex}>
            Packages
          </Text>
          {ecosystems.length > 1 && (
            <Segmented<Ecosystem>
              testID="packages-ecosystem"
              value={eco}
              onChange={setEco}
              options={[
                { value: 'npm', label: 'npm' },
                { value: 'pip', label: 'pip' },
              ]}
            />
          )}
        </View>
        <View style={styles.search}>
          <TextInput
            testID="packages-search"
            value={query}
            onChangeText={setQuery}
            placeholder={eco === 'npm' ? 'Search npm' : 'Package name on PyPI'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            clearButtonMode="while-editing"
            selectionColor={colors.brand}
            style={styles.input}
          />
          {mode === 'remote' && <Text variant="muted">Remote mode: commands run in the terminal, in the container.</Text>}
          {mode === 'local' && eco === 'pip' && <Text variant="muted">Only pure-Python packages install on the device.</Text>}
        </View>
        {query.trim() ? (
          <FlatList
            data={found ?? []}
            keyExtractor={(f) => f.name}
            renderItem={renderFound}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text variant={searchError ? 'error' : 'muted'} style={styles.empty}>
                {searchError ?? (found === null ? 'Searching...' : eco === 'pip' ? 'No package with that name on PyPI.' : 'Nothing found.')}
              </Text>
            }
          />
        ) : (
          <FlatList
            data={installed ?? []}
            keyExtractor={(p) => p.name}
            renderItem={renderInstalled}
            ListHeaderComponent={
              missing > 0 ? (
                <View style={styles.missing}>
                  <Text style={styles.flex}>
                    {missing} {missing === 1 ? 'package is' : 'packages are'} listed but not installed.
                  </Text>
                  <Button title="Install all" onPress={() => run({ kind: 'all' })} disabled={working} testID="packages-install-all" />
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              <Text variant="muted" style={styles.empty}>
                {installed === null ? 'Loading...' : eco === 'npm' ? 'No dependencies in package.json yet. Search above to add one.' : 'No packages in .pylibs or requirements.txt yet. Search above to add one.'}
              </Text>
            }
          />
        )}
        {(working || output) && (
          <ScrollView style={styles.output} contentContainerStyle={styles.outputContent}>
            <Text style={[styles.mono, failed && { color: colors.destructive }]} selectable>
              {output || 'Working...'}
            </Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  flex: { flex: 1 },
  search: { padding: spacing.md, gap: spacing.xs },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.foreground,
    fontSize: fontSizes.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  missing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.brandSoft },
  empty: { padding: spacing.md },
  output: { maxHeight: 160, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  outputContent: { padding: spacing.sm },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.foreground },
}));
