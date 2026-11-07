import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { buffersStore, projectsStore, useBuffers, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { toBase64 } from '../backup/zip';
import { appendRequest, Operation, parseSpec } from './openapi';

const METHOD_COLOR: Record<string, string> = { GET: '#3fb68b', POST: '#7c8cff', PUT: '#d9a441', PATCH: '#d9a441', DELETE: '#e5675e' };
const REQUESTS = 'requests.http';

// An OpenAPI or Swagger file as the endpoints it describes; each can go into a
// .http file to send. Free for everyone.
export function OpenApiPane({ project, path }: { project: string; path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const content = useBuffers((s) => s.buffers[bufferKey(project, path)]?.content);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [server, setServer] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (content === undefined) buffersStore.getState().load(project, path).catch(() => undefined);
  }, [content, project, path]);
  const parsed = useMemo(() => {
    if (content === undefined) return null;
    try {
      return { spec: parseSpec(content), error: null };
    } catch (e) {
      return { spec: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [content]);

  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const byTag = new Map<string, Operation[]>();
    for (const op of parsed?.spec?.operations ?? []) {
      if (q && !`${op.method} ${op.path} ${op.summary} ${op.tag}`.toLowerCase().includes(q)) continue;
      byTag.set(op.tag, [...(byTag.get(op.tag) ?? []), op]);
    }
    return [...byTag].map(([title, data]) => ({ title, data }));
  }, [parsed, filter]);

  const target = path.includes('/') ? `${path.slice(0, path.lastIndexOf('/'))}/${REQUESTS}` : REQUESTS;
  const add = async (op: Operation) => {
    const base = parsed?.spec?.servers[server] ?? 'http://localhost:3000';
    const exists = (await workspace.stat(project, target)) === 'file';
    if (exists) await buffersStore.getState().load(project, target);
    const current = exists ? (buffersStore.getState().buffers[bufferKey(project, target)]?.content ?? '') : '';
    const next = appendRequest(current, op, base);
    if (exists) await buffersStore.getState().replace(project, target, next);
    else await workspace.writeBase64(project, target, toBase64(new TextEncoder().encode(next)));
    await projectsStore.getState().loadTree(project);
    haptic('success');
    setNote(`Added ${op.method} ${op.path} to ${target}.`);
  };

  if (parsed?.error) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.screen, styles.pad]}>
        <Text variant="error" selectable>
          {parsed.error}
        </Text>
        <Text variant="muted">Switch to the source with the code button to fix it.</Text>
      </View>
    );
  }
  const spec = parsed?.spec;
  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="openapi">
      {spec && (
        <View style={styles.head}>
          <Text variant="title" numberOfLines={1}>
            {spec.title} {spec.version ? <Text variant="muted">{spec.version}</Text> : null}
          </Text>
          {spec.servers.length > 1 && (
            <View style={styles.chips}>
              {spec.servers.map((s, i) => (
                <Pressable key={s} onPress={() => setServer(i)} accessibilityRole="radio" accessibilityState={{ selected: i === server }} style={[styles.chip, i === server && styles.chipOn]}>
                  <Text variant="mono" numberOfLines={1} style={styles.small}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {spec.servers.length === 1 && (
            <Text variant="mono" numberOfLines={1} style={[styles.small, { color: colors.mutedForeground }]}>
              {spec.servers[0]}
            </Text>
          )}
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder={`Filter ${spec.operations.length} endpoints`}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.filter}
            testID="openapi-filter"
          />
          {note && <Text variant="muted">{note}</Text>}
        </View>
      )}
      <SectionList
        sections={sections}
        keyExtractor={(op) => `${op.method} ${op.path}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => <Text variant="label" style={styles.tag}>{section.title}</Text>}
        renderItem={({ item: op }) => {
          const key = `${op.method} ${op.path}`;
          const expanded = open === key;
          return (
            <View style={styles.op}>
              <Pressable onPress={() => setOpen(expanded ? null : key)} accessibilityRole="button" accessibilityState={{ expanded }} style={styles.opHead} testID={`op-${key}`}>
                <Text style={[styles.method, { color: METHOD_COLOR[op.method] ?? colors.mutedForeground }]}>{op.method}</Text>
                <View style={styles.flex}>
                  <Text variant="mono" numberOfLines={2} style={[styles.small, op.deprecated && styles.deprecated]}>
                    {op.path}
                  </Text>
                  {op.summary ? (
                    <Text variant="muted" numberOfLines={expanded ? undefined : 1}>
                      {op.summary}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {expanded && (
                <View style={styles.detail}>
                  {op.description ? <Text variant="muted">{op.description}</Text> : null}
                  {op.params.map((p) => (
                    <Text key={`${p.in}:${p.name}`} variant="mono" style={styles.small}>
                      {p.name}
                      <Text variant="muted">
                        {' '}
                        {p.in} · {p.type}
                        {p.required ? ' · required' : ''}
                        {p.description ? ` — ${p.description}` : ''}
                      </Text>
                    </Text>
                  ))}
                  {op.body && (
                    <Text variant="mono" selectable style={styles.body}>
                      {op.body.example}
                    </Text>
                  )}
                  <Button title={`Add to ${REQUESTS}`} variant="outline" icon="send" onPress={() => add(op).catch((e) => setNote(String(e?.message ?? e)))} testID="openapi-add" />
                </View>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  pad: { padding: spacing.md, gap: spacing.sm },
  head: { gap: spacing.xs + 2, padding: spacing.sm + 4, borderBottomWidth: borderWidth, borderColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { maxWidth: '100%', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  filter: { height: 36, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, color: colors.foreground, fontSize: fontSizes.sm },
  list: { padding: spacing.sm, gap: spacing.xs, paddingBottom: spacing.xl },
  tag: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  op: { borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  opHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm },
  method: { width: 56, fontFamily: fonts.mono.semibold, fontSize: fontSizes.xs + 1, paddingTop: 1 },
  flex: { flex: 1, gap: 2 },
  small: { fontSize: fontSizes.xs + 1 },
  deprecated: { textDecorationLine: 'line-through' },
  detail: { gap: spacing.xs + 2, padding: spacing.sm, paddingTop: 0 },
  body: { fontSize: fontSizes.xs, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background },
}));
