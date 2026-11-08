import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { buffersStore, workspace } from '../../state';
import { bufferKey } from '../../state/buffers';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, spacing } from '../../theme/tokens';
import { toBase64 } from '../backup/zip';
import { projectEnv } from '../env/store';
import { PROJECTS_DIR } from '../files/workspace';
import type { Notebook } from '../preview/render';
import { clearOutputs, codeCells, driverScript, notebookText, parseResults, RunStopped, startDriver, withOutputs } from './run';

const DRIVER_NAME = '.tide-notebook.py';

let next = 0;

// Runs the driver with the device's Python, in the notebook's folder.
// `onStart` gets the run's stop().
async function runDriver(project: string, dir: string, script: string, onStart: (stop: () => void) => void, stopped: () => boolean): Promise<string> {
  const id = `notebook-${Date.now()}-${++next}`;
  const rel = dir ? `${dir}/${DRIVER_NAME}` : DRIVER_NAME;
  await workspace.writeBase64(project, rel, toBase64(new TextEncoder().encode(script)));
  try {
    const env = await projectEnv(project).catch(() => ({}));
    // Stop pressed while the driver was being written.
    if (stopped()) throw new RunStopped('Stopped.');
    // Loaded here so the project screen doesn't start the runtimes just by showing a notebook.
    const { localRunner } = require('../../runtime') as typeof import('../../runtime');
    const run = startDriver(localRunner, {
      type: 'run',
      id,
      runtime: 'python',
      entry: `${PROJECTS_DIR}/${project}/${rel}`,
      cwd: `${PROJECTS_DIR}/${project}${dir ? `/${dir}` : ''}`,
      args: [],
      env,
    });
    onStart(run.stop);
    return await run.result;
  } finally {
    await workspace.deleteEntry(project, rel).catch(() => undefined);
  }
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '(empty)';

// Above a notebook's preview: run all its Python cells, or up to one, and
// clear outputs.
export function NotebookBar({ project, path }: { project: string; path: string }) {
  const styles = useStyles();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [picking, setPicking] = useState<Notebook | null>(null);
  // The running driver's stop(), and whether Stop was pressed before it started.
  const stopRun = useRef<(() => void) | null>(null);
  const stopRequested = useRef(false);
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  const read = async (): Promise<Notebook> => {
    await buffersStore.getState().load(project, path);
    return JSON.parse(buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '');
  };
  const write = (nb: Notebook) => buffersStore.getState().replace(project, path, notebookText(nb));

  const stop = () => {
    stopRequested.current = true;
    stopRun.current?.();
  };

  const run = async (upTo = Infinity) => {
    stopRequested.current = false;
    stopRun.current = null;
    setBusy(true);
    setStatus('Running…');
    try {
      const nb = await read();
      const cells = codeCells(nb, upTo);
      if (!cells.length) {
        setStatus('This notebook has no code cells.');
        return;
      }
      const out = await runDriver(
        project,
        dir,
        driverScript(cells),
        (s) => (stopRun.current = s),
        () => stopRequested.current,
      );
      const results = parseResults(out);
      await write(withOutputs(await read(), results));
      const failed = results.find((r) => r.error);
      haptic(failed ? 'error' : 'success');
      setStatus(failed ? `Stopped at a ${failed.error!.ename} in cell ${results.length} of ${cells.length}.` : `Ran ${results.length} ${results.length === 1 ? 'cell' : 'cells'}.`);
    } catch (e) {
      if (!(e instanceof RunStopped)) haptic('error');
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      stopRun.current = null;
      setBusy(false);
    }
  };

  return (
    <View style={styles.bar}>
      <View style={styles.row}>
        <Button title="Run all" icon="play" onPress={() => run()} disabled={busy} testID="notebook-run-all" />
        <Button
          title="Run to…"
          variant="outline"
          onPress={() => read().then(setPicking, (e) => setStatus(String(e?.message ?? e)))}
          disabled={busy}
          testID="notebook-run-to"
        />
        <Button
          title="Clear"
          variant="outline"
          icon="x-circle"
          onPress={() => read().then((nb) => write(clearOutputs(nb)), (e) => setStatus(String(e?.message ?? e)))}
          disabled={busy}
          testID="notebook-clear"
        />
        {busy && <Button title="Stop" variant="outline" icon="square" onPress={stop} testID="notebook-stop" />}
        {busy && <ActivityIndicator color={colors.mutedForeground} />}
      </View>
      {status && (
        <Text variant="muted" numberOfLines={2}>
          {status}
        </Text>
      )}
      <ActionSheet
        title={picking ? 'Run up to and including' : null}
        onClose={() => setPicking(null)}
        actions={(picking ? codeCells(picking) : []).map(([i, src], n) => ({
          label: `Cell ${n + 1}: ${firstLine(src).slice(0, 48)}`,
          icon: 'play' as const,
          onPress: () => {
            setPicking(null);
            run(i);
          },
        }))}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: { gap: spacing.xs, padding: spacing.sm, borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
}));
