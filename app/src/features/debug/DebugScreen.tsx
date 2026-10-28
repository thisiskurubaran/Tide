import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { nodeClient } from '../../runtime/node';
import { pythonRuntime } from '../../runtime/python';
import { colors, fonts, radius, spacing } from '../../theme/tokens';

type Line = { source: 'node' | 'python'; text: string; error?: boolean };

export function DebugScreen() {
  const [lines, setLines] = useState<Line[]>([]);

  async function capture(source: Line['source'], task: () => Promise<string>) {
    const started = Date.now();
    try {
      const text = await task();
      setLines((prev) => [...prev, { source, text: `${text.trimEnd()} (${Date.now() - started} ms)` }]);
    } catch (e) {
      setLines((prev) => [...prev, { source, text: String(e), error: true }]);
    }
  }

  const runNode = () => capture('node', () => nodeClient.request('1+1'));
  const runPython = () =>
    capture('python', async () => {
      const version = await pythonRuntime.version();
      const out = await pythonRuntime.run('print(1+1)');
      return `python ${version.split(' ')[0]}: ${out}`;
    });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tide runtime spike</Text>
      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={runNode} testID="run-node">
          <Text style={styles.buttonText}>Run Node</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={runPython} testID="run-python">
          <Text style={styles.buttonText}>Run Python</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.output} testID="output">
        {lines.map((line, i) => (
          <Text key={i} style={[styles.line, line.error && styles.error]}>
            [{line.source}] {line.text}
          </Text>
        ))}
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    paddingTop: spacing.lg * 3,
  },
  title: { color: colors.text, fontSize: 20, marginBottom: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  button: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  buttonText: { color: colors.background, fontWeight: '600' },
  output: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  line: { color: colors.text, fontFamily: fonts.mono, fontSize: 13, marginBottom: spacing.xs },
  error: { color: colors.danger },
});
