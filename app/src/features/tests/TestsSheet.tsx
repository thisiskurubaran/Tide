import { Icon } from '../../components/Icon';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { appFs, buffersStore, useRunner, workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, spacing } from '../../theme/tokens';
import { summarize, TestResult } from './results';
import { FileRun, findTestFiles, runTests, TestLanguage } from './runTests';
import { useModalAnimation } from '../../components/a11y';
import { announce } from '../../components/a11y';

export interface TestsRequest {
  // Only these files; otherwise every test file found.
  files?: string[];
  language?: TestLanguage;
}

interface TestsSheetProps {
  project: string;
  request: TestsRequest | null;
  onClose(): void;
  onOpen(path: string, line?: number): void;
  onTerminal(line: string): void;
}

// Runs the project's tests on the device (node:test files, and pytest or
// unittest) and lists the results by file.
export function TestsSheet({ project, request, onClose, onOpen, onTerminal }: TestsSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation();
  const mode = useRunner((s) => s.mode);
  const [available, setAvailable] = useState<Record<TestLanguage, string[]> | null>(null);
  const [language, setLanguage] = useState<TestLanguage>('js');
  const [runs, setRuns] = useState<FileRun[]>([]);
  const [running, setRunning] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const session = useRef<{ stop(): void } | null>(null);
  const started = useRef(0);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function start(lang: TestLanguage, files?: string[]) {
    session.current?.stop();
    const found = await findTestFiles(workspace, project);
    setAvailable(found);
    if (mode === 'remote') return;
    const list = files ?? found[lang];
    if (lang === 'js' && !list.length) {
      setRuns([]);
      return;
    }
    await buffersStore.getState().flushProject(project);
    setRuns([]);
    setOpen(null);
    setRunning(true);
    setElapsed(null);
    started.current = Date.now();
    const s = runTests({ runner: localRunner, workspace, fs: appFs }, project, lang, list, (run) =>
      setRuns((prev) => {
        const i = prev.findIndex((r) => r.file === run.file);
        return i === -1 ? [...prev, run] : prev.map((r, j) => (j === i ? run : r));
      }),
    );
    session.current = s;
    await s.done;
    if (session.current !== s) return;
    session.current = null;
    setRunning(false);
    setElapsed(Date.now() - started.current);
  }

  useEffect(() => {
    if (!request) {
      session.current?.stop();
      session.current = null;
      setRunning(false);
      return;
    }
    (async () => {
      const found = await findTestFiles(workspace, project);
      const lang = request.language ?? (found.js.length || !found.python.length ? 'js' : 'python');
      setLanguage(lang);
      setFailedOnly(false);
      start(lang, request.files);
    })();
  }, [request, project]);

  const all = runs.flatMap((r) => r.results);
  const counts = summarize(all);
  useEffect(() => {
    if (!running && elapsed !== null) {
      haptic(counts.fail ? 'error' : 'success');
      announce(`Tests finished: ${counts.pass} passed${counts.fail ? `, ${counts.fail} failed` : ''}`);
    }
  }, [running, elapsed]);

  const sections = runs
    .filter((r) => !r.done || r.results.length || r.output)
    .map((r) => ({ run: r, data: failedOnly ? r.results.filter((t) => t.status === 'fail') : r.results }))
    .filter((s) => !failedOnly || s.data.length);

  const icon = (t: TestResult) =>
    t.status === 'pass' ? (
      <Icon name="check-circle" size={16} color={colors.success} />
    ) : t.status === 'fail' ? (
      <Icon name="x-circle" size={16} color={colors.destructive} />
    ) : (
      <Icon name="minus-circle" size={16} color={colors.mutedForeground} />
    );

  const both = !!available && available.js.length > 0 && available.python.length > 0;
  const nothing = available && !available.js.length && !available.python.length;

  return (
    <Modal visible={request !== null} animationType={animation} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]} onAccessibilityEscape={onClose}>
        <View style={styles.header}>
          <IconButton icon="x" label="Close" onPress={onClose} testID="tests-close" />
          <Text variant="title" style={styles.flex}>
            Tests
          </Text>
          {both && (
            <Segmented<TestLanguage>
              testID="tests-language"
              value={language}
              onChange={(l) => {
                setLanguage(l);
                start(l);
              }}
              options={[
                { value: 'js', label: 'JavaScript' },
                { value: 'python', label: 'Python' },
              ]}
            />
          )}
          {running ? (
            <IconButton icon="square" label="Stop" onPress={() => session.current?.stop()} testID="tests-stop" />
          ) : (
            <IconButton icon="play" label="Run again" onPress={() => start(language, request?.files)} testID="tests-run" />
          )}
        </View>

        {mode === 'remote' ? (
          <View style={styles.message}>
            <Text variant="muted">In Remote mode, tests run in the container. Run them in the terminal:</Text>
            <View style={styles.row}>
              <Button title="npm test" variant="outline" onPress={() => (onTerminal('npm test'), onClose())} />
              <Button title="pytest" variant="outline" onPress={() => (onTerminal('python3 -m pytest'), onClose())} />
            </View>
          </View>
        ) : nothing ? (
          <View style={styles.message}>
            <Text variant="label">No tests found</Text>
            <Text variant="muted">
              JavaScript: files named *.test.js or *.spec.js, or in a test folder, using node:test. Python: test_*.py or *_test.py files, run with pytest when it's
              installed (pip install pytest) and unittest otherwise.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.summary}>
              <Text style={styles.flex} testID="tests-summary">
                {running
                  ? `Running ${runs.find((r) => !r.done)?.file ?? ''}…`
                  : `${counts.pass} passed${counts.fail ? ` · ${counts.fail} failed` : ''}${counts.skip ? ` · ${counts.skip} skipped` : ''}${elapsed !== null ? ` · ${(elapsed / 1000).toFixed(1)} s` : ''}`}
              </Text>
              {counts.fail > 0 && (
                <Pressable onPress={() => setFailedOnly((f) => !f)} accessibilityRole="switch" accessibilityState={{ checked: failedOnly }} testID="tests-failed-only">
                  <Text style={{ color: failedOnly ? colors.brand : colors.mutedForeground }}>Failed only</Text>
                </Pressable>
              )}
            </View>
            <SectionList
              sections={sections}
              keyExtractor={(t, i) => `${t.file}:${t.name}:${i}`}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => {
                const c = summarize(section.run.results);
                return (
                  <View style={styles.fileHeader}>
                    <Icon name="file-text" size={14} color={colors.mutedForeground} />
                    <Text variant="label" style={styles.flex} numberOfLines={1}>
                      {section.run.file}
                    </Text>
                    <Text variant="muted">{section.run.done ? (c.fail ? `${c.fail} failed` : `${c.pass} passed`) : '…'}</Text>
                  </View>
                );
              }}
              renderSectionFooter={({ section }) =>
                section.run.output && !failedOnly ? (
                  <View style={styles.output}>
                    <Text style={styles.mono} numberOfLines={open === `out:${section.run.file}` ? undefined : 3} onPress={() => setOpen(open === `out:${section.run.file}` ? null : `out:${section.run.file}`)}>
                      {section.run.output}
                    </Text>
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                const key = `${item.file}:${item.name}`;
                return (
                  <View>
                    <Pressable
                      style={({ pressed }) => [styles.test, pressed && { backgroundColor: colors.secondary }]}
                      onPress={() => (item.message ? setOpen(open === key ? null : key) : item.file && (onOpen(item.file, item.line ?? undefined), onClose()))}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.name}, ${item.status === 'pass' ? 'passed' : item.status === 'fail' ? 'failed' : 'skipped'}`}
                    >
                      {icon(item)}
                      <Text style={styles.flex} numberOfLines={2}>
                        {item.name}
                      </Text>
                      {item.ms !== null && <Text variant="muted">{item.ms} ms</Text>}
                    </Pressable>
                    {open === key && item.message && (
                      <View style={styles.failure}>
                        <Text style={styles.mono} selectable>
                          {item.message}
                        </Text>
                        {item.file && (
                          <Button
                            title={item.line ? `Open ${item.file.split('/').pop()}:${item.line}` : `Open ${item.file.split('/').pop()}`}
                            variant="outline"
                            icon="external-link"
                            onPress={() => {
                              onOpen(item.file!, item.line ?? undefined);
                              onClose();
                            }}
                          />
                        )}
                      </View>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={
                running ? undefined : (
                  <Text variant="muted" style={styles.message}>
                    {failedOnly ? 'No failures.' : 'No results yet.'}
                  </Text>
                )
              }
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: borderWidth, borderColor: colors.border },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  message: { padding: spacing.md, gap: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border },
  fileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  test: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  failure: { marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: spacing.sm, gap: spacing.sm, borderLeftWidth: 3, borderColor: colors.destructive, backgroundColor: colors.card },
  output: { marginHorizontal: spacing.md, padding: spacing.sm, backgroundColor: colors.card },
  mono: { fontFamily: fonts.mono.regular, fontSize: fontSizes.xs, color: colors.foreground },
}));
