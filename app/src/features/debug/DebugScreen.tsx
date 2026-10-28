import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { nodeRunner } from '../../runtime/node';
import { pythonRuntime } from '../../runtime/python';
import { borderWidth, fonts, fontSizes, letterSpacing, radius, spacing } from '../../theme/tokens';
import { makeStyles } from '../../theme/theme';

type Line = { source: 'node' | 'python'; text: string; error?: boolean };

export function DebugScreen() {
  const styles = useStyles();
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

  const runNode = () =>
    capture('node', async () => {
      const pong = await nodeRunner.ping();
      return `node ${pong.node} on ${pong.platform}/${pong.arch}`;
    });
  const runPython = () =>
    capture('python', async () => {
      const version = await pythonRuntime.version();
      const out = await pythonRuntime.snippet('print(1+1)');
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

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.md,
    paddingTop: spacing.lg * 3,
  },
  title: {
    color: colors.foreground,
    fontFamily: fonts.heading.medium,
    fontSize: fontSizes.xxl,
    letterSpacing: letterSpacing(fontSizes.xxl),
    marginBottom: spacing.md,
  },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  button: {
    flex: 1,
    // FuseOps primary buttons are foreground on background, not brand colored.
    backgroundColor: colors.foreground,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  buttonText: { color: colors.background, fontFamily: fonts.sans.medium, fontSize: fontSizes.sm },
  output: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  line: { color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, marginBottom: spacing.xs },
  error: { color: colors.destructive },
}));
