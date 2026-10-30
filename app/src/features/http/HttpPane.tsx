import Feather from '@expo/vector-icons/Feather';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { announce } from '../../components/a11y';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { FormSheet } from '../../components/FormSheet';
import { buffersStore, projectsStore, useBuffers, workspace } from '../../state';
import { toBase64 } from '../backup/zip';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import {
  ENV_FILE,
  ENV_TEMPLATE,
  Environments,
  formatBody,
  HTTP_TEMPLATE,
  HttpResponse,
  parseEnvironments,
  parseHttpFile,
  PRIVATE_ENV_FILE,
  resolveRequest,
  responseFileName,
  send,
} from './http';

type Result = { response: HttpResponse } | { error: string } | 'sending';

// The environment picked per .http file, for this session.
const picked = new Map<string, string | null>();

const readIfThere = (project: string, path: string) => workspace.readFile(project, path).catch(() => null);

// http-client.env.json next to the file, or else at the project root.
async function loadEnvironments(project: string, path: string): Promise<{ envs: Environments; dir: string }> {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  for (const d of dir ? [dir, ''] : ['']) {
    const shared = await readIfThere(project, `${d}${ENV_FILE}`);
    const secret = await readIfThere(project, `${d}${PRIVATE_ENV_FILE}`);
    if (shared || secret) return { envs: parseEnvironments(shared, secret), dir: d };
  }
  return { envs: {}, dir };
}

const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

// The requests in a .http file, each with a Send button and its response.
// Editing happens in the source view. Free for everyone.
export function HttpPane({ project, path }: { project: string; path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const content = useBuffers((s) => s.buffers[bufferKey(project, path)]?.content);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [openHeaders, setOpenHeaders] = useState<Record<number, boolean>>({});
  const [envs, setEnvs] = useState<{ envs: Environments; dir: string }>({ envs: {}, dir: '' });
  const [env, setEnv] = useState<string | null>(() => picked.get(`${project}/${path}`) ?? null);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    loadEnvironments(project, path).then((e) => {
      setEnvs(e);
      setEnv((current) => (current && current in e.envs ? current : (Object.keys(e.envs)[0] ?? null)));
    });
  }, [project, path, content]);
  useEffect(() => {
    picked.set(`${project}/${path}`, env);
  }, [project, path, env]);

  useEffect(() => {
    if (content === undefined) buffersStore.getState().load(project, path).catch(() => undefined);
  }, [content, project, path]);

  const parsed = useMemo(() => {
    const p = parseHttpFile(content ?? '');
    // The environment's values win over the file's @ variables.
    return { ...p, variables: { ...p.variables, ...(env ? envs.envs[env] : {}) } };
  }, [content, env, envs]);
  const envNames = Object.keys(envs.envs);

  const addEnvironments = async () => {
    const file = `${envs.dir}${ENV_FILE}`;
    await workspace.writeBase64(project, file, toBase64(new TextEncoder().encode(ENV_TEMPLATE)));
    await projectsStore.getState().loadTree(project);
    setEnvs(await loadEnvironments(project, path));
    haptic('success');
  };

  const sendAt = async (i: number) => {
    const req = resolveRequest(parsed.requests[i], parsed.variables);
    setResults((r) => ({ ...r, [i]: 'sending' }));
    try {
      const response = await send(req);
      setResults((r) => ({ ...r, [i]: { response } }));
      haptic(response.status < 400 ? 'success' : 'error');
      announce(`${response.status} ${response.statusText}`);
    } catch (e) {
      setResults((r) => ({ ...r, [i]: { error: e instanceof Error ? e.message : String(e) } }));
      haptic('error');
    }
  };

  const savingResult = saving === null ? undefined : results[saving];
  const savingResponse = savingResult && savingResult !== 'sending' && 'response' in savingResult ? savingResult.response : null;

  const statusColor = (status: number) => (status < 300 ? colors.success : status < 400 ? colors.warning : colors.destructive);

  return (
    <View style={[StyleSheet.absoluteFill, styles.screen]} testID="http">
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {parsed.requests.length > 0 && (
          <View style={styles.envs} accessibilityRole="radiogroup" accessibilityLabel="Environment">
            {envNames.length ? (
              [null, ...envNames].map((name) => (
                <Pressable
                  key={name ?? '-'}
                  onPress={() => setEnv(name)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: env === name }}
                  style={[styles.envChip, env === name && styles.envChipOn]}
                  testID={`http-env-${name ?? 'none'}`}
                >
                  <Text variant="label">{name ?? 'No environment'}</Text>
                </Pressable>
              ))
            ) : (
              <Pressable onPress={addEnvironments} accessibilityRole="button" style={styles.envChip} testID="http-add-env">
                <Text variant="muted">+ Environments (dev, prod…)</Text>
              </Pressable>
            )}
          </View>
        )}
        {content !== undefined && parsed.requests.length === 0 && (
          <View style={styles.empty}>
            <Text variant="title">No requests yet</Text>
            <Text variant="muted" style={styles.center}>
              Write requests in the source view (tap the code icon), or start from an example.
            </Text>
            <Button title="Add example requests" icon="plus" onPress={() => buffersStore.getState().edit(project, path, `${content}${content ? '\n' : ''}${HTTP_TEMPLATE}`)} testID="http-example" />
          </View>
        )}
        {parsed.requests.map((raw, i) => {
          const req = resolveRequest(raw, parsed.variables);
          const result = results[i];
          return (
            <View key={`${i}-${raw.line}`} style={styles.card} testID={`http-request-${i}`}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text variant="label" numberOfLines={1}>
                    {raw.name}
                  </Text>
                  <Text variant="mono" numberOfLines={2} style={styles.url}>
                    <Text variant="mono" style={{ color: colors.brand }}>
                      {req.method}
                    </Text>{' '}
                    {req.url}
                  </Text>
                </View>
                <Button title={result === 'sending' ? 'Sending…' : 'Send'} icon="send" onPress={() => sendAt(i)} disabled={result === 'sending'} testID={`http-send-${i}`} />
              </View>
              {result && result !== 'sending' && 'error' in result && (
                <Text variant="error" selectable>
                  {result.error}
                </Text>
              )}
              {result && result !== 'sending' && 'response' in result && (
                <View style={styles.response}>
                  <View style={styles.meta}>
                    <Text variant="label" style={{ color: statusColor(result.response.status) }}>
                      {result.response.status} {result.response.statusText}
                    </Text>
                    <Text variant="muted">
                      {result.response.ms} ms · {formatBytes(result.response.bytes)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setOpenHeaders((o) => ({ ...o, [i]: !o[i] }))}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !!openHeaders[i] }}
                    style={styles.headersToggle}
                  >
                    <Feather name={openHeaders[i] ? 'chevron-down' : 'chevron-right'} size={14} color={colors.mutedForeground} />
                    <Text variant="muted">Headers ({result.response.headers.length})</Text>
                  </Pressable>
                  {openHeaders[i] &&
                    result.response.headers.map(([k, v]) => (
                      <Text key={k} variant="mono" selectable style={styles.header}>
                        <Text variant="mono" style={{ color: colors.mutedForeground }}>
                          {k}:
                        </Text>{' '}
                        {v}
                      </Text>
                    ))}
                  {result.response.body !== '' && (
                    <Text variant="mono" selectable style={styles.body}>
                      {formatBody(result.response.body, result.response.headers)}
                    </Text>
                  )}
                  {result.response.truncated && <Text variant="muted">Showing the first 1 MB of the response.</Text>}
                  <View style={styles.saveRow}>
                    <Button title="Save" variant="outline" icon="save" onPress={() => setSaving(i)} testID={`http-save-${i}`} />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <FormSheet
        visible={saving !== null}
        title="Save the response"
        confirmLabel="Save"
        fields={[
          {
            key: 'path',
            label: 'File',
            mono: true,
            required: true,
            initial: savingResponse ? responseFileName(parsed.requests[saving!]?.name ?? '', savingResponse.headers) : '',
          },
        ]}
        onClose={() => setSaving(null)}
        onSubmit={async ({ path: file }) => {
          const body = formatBody(savingResponse!.body, savingResponse!.headers);
          await workspace.writeBase64(project, file.trim(), toBase64(new TextEncoder().encode(body)));
          await projectsStore.getState().loadTree(project);
          haptic('success');
          setSaving(null);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { backgroundColor: colors.background },
  list: { padding: spacing.sm, gap: spacing.sm, paddingBottom: spacing.xl },
  flex: { flex: 1, gap: 2 },
  center: { textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg },
  card: { gap: spacing.sm, padding: spacing.sm + 4, borderRadius: radius.lg, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  url: { fontSize: fontSizes.xs + 1 },
  response: { gap: spacing.xs, borderTopWidth: borderWidth, borderColor: colors.border, paddingTop: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  headersToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  header: { fontSize: fontSizes.xs },
  envs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  envChip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  envChipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  body: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs + 1, backgroundColor: colors.background, borderRadius: radius.sm, padding: spacing.sm },
}));
