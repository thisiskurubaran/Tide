import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import * as t from './tools';

type ToolId = 'json' | 'yaml' | 'csv' | 'base64' | 'url' | 'jwt' | 'hash' | 'uuid' | 'time' | 'regex';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'regex', label: 'Regex' },
  { id: 'yaml', label: 'YAML ⇄ JSON' },
  { id: 'csv', label: 'CSV → JSON' },
  { id: 'base64', label: 'Base64' },
  { id: 'url', label: 'URL' },
  { id: 'jwt', label: 'JWT' },
  { id: 'hash', label: 'Hash' },
  { id: 'uuid', label: 'UUID' },
  { id: 'time', label: 'Timestamp' },
];

const PLACEHOLDER: Record<ToolId, string> = {
  json: '{"paste": "JSON here"}',
  yaml: 'YAML or JSON',
  csv: 'name,email\nAda,ada@example.com',
  base64: 'Text, or Base64 to decode',
  url: 'Text, or URL-encoded text',
  jwt: 'eyJhbGciOi…',
  hash: 'Text to hash',
  uuid: '',
  time: 'A Unix timestamp or a date; empty for now',
  regex: 'Text to test the pattern against',
};

const FLAGS = ['g', 'i', 'm', 's', 'u'];

type Output = { kind: 'text'; value: string } | { kind: 'rows'; rows: { name: string; value: string }[] };

// Conversions and checks developers reach for, offline. Free for everyone.
export function ToolsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const [tool, setTool] = useState<ToolId>('json');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');

  const pick = (id: ToolId) => {
    setTool(id);
    setOutput(null);
    setError(null);
  };
  const run = (fn: () => Output) => {
    try {
      setOutput(fn());
      setError(null);
    } catch (e) {
      setOutput(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const textOut = (value: string): Output => ({ kind: 'text', value });
  const copy = (value: string) => Clipboard.setStringAsync(value).then(() => haptic('success'));

  const regex = useMemo(() => {
    if (tool !== 'regex') return null;
    try {
      return { matches: t.testRegex(pattern, flags, input), error: null };
    } catch (e) {
      return { matches: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [tool, pattern, flags, input]);

  const actions: { label: string; run: () => Output }[] =
    tool === 'json'
      ? [
          { label: 'Format', run: () => textOut(t.formatJson(input)) },
          { label: 'Minify', run: () => textOut(t.minifyJson(input)) },
        ]
      : tool === 'yaml'
        ? [
            { label: 'YAML → JSON', run: () => textOut(t.yamlToJson(input)) },
            { label: 'JSON → YAML', run: () => textOut(t.jsonToYaml(input)) },
          ]
        : tool === 'csv'
          ? [{ label: 'Convert', run: () => textOut(t.csvToJson(input)) }]
          : tool === 'base64'
            ? [
                { label: 'Encode', run: () => textOut(t.base64Encode(input)) },
                { label: 'Decode', run: () => textOut(t.base64Decode(input)) },
              ]
            : tool === 'url'
              ? [
                  { label: 'Encode', run: () => textOut(t.urlEncode(input)) },
                  { label: 'Decode', run: () => textOut(t.urlDecode(input)) },
                ]
              : tool === 'jwt'
                ? [
                    {
                      label: 'Decode',
                      run: () => {
                        const d = t.decodeJwt(input);
                        return textOut(`// Header\n${JSON.stringify(d.header, null, 2)}\n\n// Payload\n${JSON.stringify(d.payload, null, 2)}\n\n${d.notes.join('\n')}`);
                      },
                    },
                  ]
                : tool === 'hash'
                  ? [{ label: 'Hash', run: () => ({ kind: 'rows', rows: t.hashes(input) }) }]
                  : tool === 'uuid'
                    ? [{ label: 'New UUIDs', run: () => textOut(Array.from({ length: 5 }, () => t.uuid()).join('\n')) }]
                    : tool === 'time'
                      ? [{ label: 'Convert', run: () => ({ kind: 'rows', rows: t.timestamp(input) }) }]
                      : [];

  return (
    <Screen title="Developer tools" subtitle="On your device, offline" testID="tools">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {TOOLS.map((x) => (
          <Pressable key={x.id} onPress={() => pick(x.id)} accessibilityRole="tab" accessibilityState={{ selected: tool === x.id }} style={[styles.chip, tool === x.id && styles.chipOn]} testID={`tool-${x.id}`}>
            <Text variant="label">{x.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {tool === 'regex' && (
        <View style={styles.field}>
          <View style={styles.patternRow}>
            <Text variant="mono" style={{ color: colors.mutedForeground }}>
              /
            </Text>
            <TextInput
              value={pattern}
              onChangeText={setPattern}
              placeholder="(\w+)@(\w+)\.com"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={[styles.pattern]}
              testID="regex-pattern"
            />
            <Text variant="mono" style={{ color: colors.mutedForeground }}>
              /{flags}
            </Text>
            <IconButton icon="copy" label="Copy as a JavaScript literal" onPress={() => copy(t.regexLiteral(pattern, flags))} />
          </View>
          <View style={styles.chipsWrap}>
            {FLAGS.map((f) => (
              <Pressable
                key={f}
                onPress={() => setFlags((cur) => (cur.includes(f) ? cur.replace(f, '') : FLAGS.filter((x) => cur.includes(x) || x === f).join('')))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: flags.includes(f) }}
                style={[styles.flag, flags.includes(f) && styles.chipOn]}
                testID={`regex-flag-${f}`}
              >
                <Text variant="mono">{f}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {tool !== 'uuid' && (
        <TextInput
          value={input}
          onChangeText={(v) => {
            setInput(v);
            setError(null);
          }}
          placeholder={PLACEHOLDER[tool]}
          placeholderTextColor={colors.mutedForeground}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.input}
          testID="tool-input"
        />
      )}

      {actions.length > 0 && (
        <View style={styles.actions}>
          {actions.map((a, i) => (
            <Button key={a.label} title={a.label} variant={i === 0 ? 'primary' : 'outline'} onPress={() => run(a.run)} testID={`tool-action-${i}`} />
          ))}
        </View>
      )}

      {error && (
        <Text variant="error" selectable>
          {error}
        </Text>
      )}

      {regex && (
        <View style={styles.field}>
          {regex.error ? (
            <Text variant="error">{regex.error}</Text>
          ) : (
            <Text variant="muted">
              {pattern ? `${regex.matches.length}${regex.matches.length >= t.MAX_MATCHES ? '+' : ''} ${regex.matches.length === 1 ? 'match' : 'matches'}` : 'Type a pattern.'}
            </Text>
          )}
          {regex.matches.length > 0 && (
            <Text variant="mono" style={styles.output} selectable testID="regex-highlighted">
              {highlight(input, regex.matches).map((part, i) =>
                part.match ? (
                  <Text key={i} variant="mono" style={{ backgroundColor: colors.brandSoft, color: colors.foreground }}>
                    {part.text}
                  </Text>
                ) : (
                  part.text
                ),
              )}
            </Text>
          )}
          {regex.matches.slice(0, 50).map((m, i) => (
            <View key={i} style={styles.match}>
              <Text variant="mono" numberOfLines={1}>
                {i + 1}. “{m.text}” at {m.index}
              </Text>
              {m.groups.map((g, j) => (
                <Text key={j} variant="muted" numberOfLines={1}>
                  {`  $${j + 1}${Object.entries(m.named).find(([, v]) => v === g && v !== undefined)?.[0] ? ` (${Object.entries(m.named).find(([, v]) => v === g)![0]})` : ''}: ${g ?? '(none)'}`}
                </Text>
              ))}
            </View>
          ))}
        </View>
      )}

      {output?.kind === 'text' && (
        <View style={styles.field}>
          <Text variant="mono" selectable style={styles.output} testID="tool-output">
            {output.value}
          </Text>
          <Button title="Copy" variant="outline" icon="copy" onPress={() => copy(output.value)} />
        </View>
      )}
      {output?.kind === 'rows' &&
        output.rows.map((r) => (
          <Pressable key={r.name} onPress={() => copy(r.value)} accessibilityRole="button" accessibilityHint="Copies it" style={styles.row}>
            <Text variant="label">{r.name}</Text>
            <Text variant="mono" selectable style={styles.rowValue}>
              {r.value}
            </Text>
          </Pressable>
        ))}
    </Screen>
  );
}

// The subject split into matched and unmatched parts.
function highlight(subject: string, matches: t.RegexMatch[]): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const m of matches) {
    if (!m.text) continue;
    if (m.index > at) parts.push({ text: subject.slice(at, m.index), match: false });
    parts.push({ text: m.text, match: true });
    at = m.index + m.text.length;
  }
  if (at < subject.length) parts.push({ text: subject.slice(at), match: false });
  return parts;
}

const useStyles = makeStyles((colors) => ({
  chips: { gap: spacing.xs + 2 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  chip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs + 1, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  flag: { minWidth: 36, alignItems: 'center', paddingVertical: spacing.xs, borderRadius: radius.sm, borderWidth, borderColor: colors.border },
  field: { gap: spacing.xs + 2 },
  patternRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  pattern: { flex: 1, height: 44, color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  input: {
    minHeight: 120,
    maxHeight: 260,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  output: { fontSize: fontSizes.xs + 1, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.card, borderWidth, borderColor: colors.border },
  match: { gap: 2 },
  row: { gap: 2, padding: spacing.sm + 2, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  rowValue: { fontSize: fontSizes.xs + 1 },
}));
