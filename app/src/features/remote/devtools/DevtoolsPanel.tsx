import { useState } from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';

import { IconButton } from '../../../components/Button';
import { Segmented } from '../../../components/Segmented';
import { Text } from '../../../components/Text';
import { makeStyles, useColors } from '../../../theme/theme';
import { borderWidth, fonts, fontSizes, spacing } from '../../../theme/tokens';
import { ConsoleEntry, DevtoolsState, Request, shortUrl } from './devtools';

interface DevtoolsPanelProps {
  state: DevtoolsState;
  onEval(code: string): void;
  onClear(): void;
}

const size = (n: number | null) => (n === null ? '' : n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

// Console and network for the preview, docked under the page.
export function DevtoolsPanel({ state, onEval, onClear }: DevtoolsPanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [tab, setTab] = useState<'console' | 'network'>('console');
  const [code, setCode] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const levelColor = (e: ConsoleEntry) =>
    e.level === 'error' ? colors.destructive : e.level === 'warn' ? colors.warning : e.kind === 'input' ? colors.brand : e.kind === 'result' ? colors.mutedForeground : colors.foreground;

  const renderEntry = ({ item }: { item: ConsoleEntry }) => (
    <View style={styles.entry}>
      <Text style={[styles.prefix, { color: levelColor(item) }]}>{item.kind === 'input' ? '›' : item.kind === 'result' ? '‹' : ''}</Text>
      <View style={styles.flex}>
        <Text selectable style={[styles.mono, { color: levelColor(item) }]}>
          {item.text}
        </Text>
        {item.source && <Text style={styles.source}>{item.source}</Text>}
      </View>
    </View>
  );

  const renderRequest = ({ item }: { item: Request }) => {
    const failed = item.error !== null || (item.status !== null && item.status >= 400);
    return (
      <Pressable onPress={() => setOpen(open === item.id ? null : item.id)} style={styles.entry} accessibilityRole="button">
        <Text style={[styles.method, styles.mono]}>{item.method}</Text>
        <View style={styles.flex}>
          <Text style={[styles.mono, failed && { color: colors.destructive }]} numberOfLines={open === item.id ? undefined : 1}>
            {open === item.id ? item.url : shortUrl(item.url, state.url)}
          </Text>
          {open === item.id && (
            <Text style={styles.source}>
              {[item.type.toUpperCase(), item.contentType, item.error].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        <Text style={[styles.meta, failed && { color: colors.destructive }]}>{item.error ? 'failed' : (item.status ?? '…')}</Text>
        <Text style={styles.meta}>{item.ms === null ? '' : `${item.ms} ms`}</Text>
        <Text style={styles.meta}>{size(item.size)}</Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.panel} testID="devtools">
      <View style={styles.bar}>
        <Segmented<'console' | 'network'>
          testID="devtools-tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'console', label: state.errors ? `Console (${state.errors})` : 'Console' },
            { value: 'network', label: `Network (${state.requests.length})` },
          ]}
        />
        <View style={styles.flex} />
        {tab === 'console' && <IconButton icon="slash" label="Clear console" onPress={onClear} testID="devtools-clear" />}
      </View>
      {tab === 'console' ? (
        <>
          <FlatList
            data={state.console}
            keyExtractor={(e) => String(e.key)}
            renderItem={renderEntry}
            style={styles.flex}
            ListEmptyComponent={<Text variant="muted" style={styles.empty}>Console output from the page shows up here.</Text>}
          />
          <View style={styles.inputRow}>
            <Text style={[styles.prefix, { color: colors.brand }]}>›</Text>
            <TextInput
              testID="devtools-input"
              value={code}
              onChangeText={setCode}
              onSubmitEditing={() => {
                if (!code.trim()) return;
                onEval(code);
                setCode('');
              }}
              placeholder="Evaluate JavaScript in the page"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="go"
              blurOnSubmit={false}
              selectionColor={colors.brand}
              style={[styles.input, styles.mono]}
            />
          </View>
        </>
      ) : (
        <FlatList
          data={state.requests}
          keyExtractor={(r) => r.id}
          renderItem={renderRequest}
          style={styles.flex}
          ListEmptyComponent={<Text variant="muted" style={styles.empty}>Requests the page makes with fetch or XMLHttpRequest show up here.</Text>}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: { flex: 1, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: spacing.sm },
  flex: { flex: 1 },
  entry: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 4, borderBottomWidth: borderWidth, borderColor: colors.border, alignItems: 'flex-start' },
  prefix: { width: 10, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, color: colors.foreground },
  source: { fontSize: 11, color: colors.mutedForeground },
  method: { width: 44, color: colors.mutedForeground },
  meta: { fontSize: 11, color: colors.mutedForeground, minWidth: 34, textAlign: 'right' },
  empty: { padding: spacing.md },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderTopWidth: borderWidth, borderColor: colors.border },
  input: { flex: 1, height: 40 },
}));
