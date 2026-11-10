import { Icon } from '../../components/Icon';
import type { DebugVariable } from '@shared/protocol';
import { ComponentRef, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useStore } from 'zustand';

import { IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { buffersStore, workspace } from '../../state';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import type { PanelProps, ProjectContext, TideExtension } from '../types';
import { breakpointsStore, useBreakpoints } from './breakpoints';
import { createDebugStore, DebugState, runtimeFor } from './session';

export const debugStore = createDebugStore(localRunner, breakpointsStore);
const useDebug = <T,>(selector: (s: DebugState) => T) => useStore(debugStore, selector);

const PANEL = 'debugger.panel';

// The active file if it can be debugged, otherwise the project's run entry from tide.json.
async function entryFor(ctx: ProjectContext): Promise<string | null> {
  const active = ctx.activePath();
  if (active && runtimeFor(active)) return active;
  try {
    const config = JSON.parse(await workspace.readFile(ctx.project, 'tide.json')) as { entry?: string };
    if (config.entry && runtimeFor(config.entry)) return config.entry;
  } catch {
    // no tide.json, or not JSON
  }
  return null;
}

async function start(ctx: ProjectContext) {
  const entry = await entryFor(ctx);
  if (!entry) {
    Alert.alert('Debug', 'Open a JavaScript or Python file to debug it, or set an entry in tide.json.');
    return;
  }
  // The program reads files from disk, so unsaved edits go first.
  await buffersStore.getState().flushProject(ctx.project);
  debugStore.getState().start(ctx.project, entry);
}

// The toolbar under the tabs while a session runs.
function DebugBar({ ctx }: { ctx: ProjectContext }) {
  const styles = useStyles();
  const colors = useColors();
  const status = useDebug((s) => (s.project === ctx.project ? s.status : 'idle'));
  const paused = useBreakpoints((s) => (s.paused?.project === ctx.project ? s.paused : null));
  const debug = debugStore.getState();

  // Show where it stopped.
  useEffect(() => {
    if (paused) ctx.openFile(paused.path, paused.line);
    // ctx is rebuilt on every render; only a new pause location should move the editor.
  }, [paused?.path, paused?.line]);

  if (status === 'idle') return null;
  const live = status === 'running' || status === 'paused' || status === 'starting';
  const label =
    status === 'paused' ? (paused ? `Paused at ${paused.path.split('/').pop()}:${paused.line}` : 'Paused') : status === 'ended' ? 'Finished' : 'Running';
  return (
    <View style={styles.bar} testID="debug-bar">
      <Icon name="crosshair" size={14} color={status === 'paused' ? colors.warning : colors.mutedForeground} />
      <Text variant="muted" style={styles.status} numberOfLines={1}>
        {label}
      </Text>
      {live && (
        <>
          {status === 'paused' ? (
            <IconButton icon="play" label="Continue" color={colors.success} onPress={() => debug.command('continue')} testID="debug-continue" />
          ) : (
            <IconButton icon="pause" label="Pause" onPress={() => debug.command('pause')} testID="debug-pause" />
          )}
          <IconButton icon="corner-down-right" label="Step over" onPress={() => debug.command('stepOver')} testID="debug-step-over" />
          <IconButton icon="arrow-down-right" label="Step into" onPress={() => debug.command('stepInto')} testID="debug-step-into" />
          <IconButton icon="arrow-up-left" label="Step out" onPress={() => debug.command('stepOut')} testID="debug-step-out" />
          <IconButton icon="square" label="Stop" color={colors.destructive} onPress={() => debug.stop()} testID="debug-stop" />
        </>
      )}
      {!live && <IconButton icon="rotate-cw" label="Debug again" onPress={() => start(ctx)} testID="debug-restart" />}
      <IconButton icon="list" label="Debug panel" onPress={() => ctx.openPanel(PANEL)} testID="debug-panel" />
      {!live && <IconButton icon="x" label="Close debugger" onPress={() => debug.close()} testID="debug-close" />}
    </View>
  );
}

function VariableRow({ variable, depth }: { variable: DebugVariable; depth: number }) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const children = useDebug((s) => (variable.ref ? s.variables[variable.ref] : undefined));
  const toggle = () => {
    if (!variable.ref) return;
    if (!open && !children) debugStore.getState().loadVariables(variable.ref);
    setOpen((o) => !o);
  };
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={toggle} style={[styles.variable, { paddingLeft: spacing.xs + depth * spacing.md }]} testID={`var-${variable.name}`}>
        <Icon name={variable.ref ? (open ? 'chevron-down' : 'chevron-right') : 'minus'} size={12} color={variable.ref ? colors.mutedForeground : 'transparent'} />
        <Text variant="mono" style={styles.varName}>
          {variable.name}
        </Text>
        <Text variant="mono" style={styles.varValue} numberOfLines={open ? undefined : 1}>
          {variable.value}
        </Text>
      </Pressable>
      {open && !children && <Text variant="muted" style={{ paddingLeft: spacing.lg + depth * spacing.md }}>Loading...</Text>}
      {open && children?.map((c, i) => <VariableRow key={`${c.name}-${i}`} variable={c} depth={depth + 1} />)}
    </View>
  );
}

function DebugPanel({ ctx, visible, onClose }: PanelProps) {
  const styles = useStyles();
  const colors = useColors();
  const [tab, setTab] = useState<'variables' | 'stack' | 'console'>('variables');
  const [input, setInput] = useState('');
  const status = useDebug((s) => s.status);
  const frames = useDebug((s) => s.frames);
  const selected = useDebug((s) => s.frame);
  const variables = useDebug((s) => s.variables);
  const lines = useDebug((s) => s.console);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const debug = debugStore.getState();
  const frame = frames[selected];
  const prefix = `projects/${ctx.project}/`;

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    // Paused: evaluate in the frame. Running: the line goes to the program's input().
    if (status === 'paused') debug.evaluate(text);
    else debug.input(input);
    setInput('');
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">Debug</Text>
      <Segmented<'variables' | 'stack' | 'console'>
        testID="debug-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'variables', label: 'Variables' },
          { value: 'stack', label: 'Call stack' },
          { value: 'console', label: 'Console' },
        ]}
      />
      {tab === 'variables' && (
        <ScrollView style={styles.list}>
          {status !== 'paused' && <Text variant="muted">Variables show while the program is paused at a breakpoint.</Text>}
          {frame?.scopes.map((scope) => (
            <View key={scope.ref}>
              <Text variant="label" style={styles.scope}>
                {scope.name}
              </Text>
              {(variables[scope.ref] ?? []).map((v, i) => (
                <VariableRow key={`${v.name}-${i}`} variable={v} depth={0} />
              ))}
              {!variables[scope.ref] && (
                <Pressable accessibilityRole="button" onPress={() => debug.loadVariables(scope.ref)}>
                  <Text variant="muted">Show</Text>
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      {tab === 'stack' && (
        <ScrollView style={styles.list}>
          {frames.length === 0 && <Text variant="muted">The call stack shows while the program is paused.</Text>}
          {frames.map((f, i) => {
            const inProject = f.file?.startsWith(prefix);
            return (
              <Pressable accessibilityRole="button"
                key={i}
                testID={`frame-${i}`}
                onPress={() => {
                  debug.selectFrame(i);
                  if (inProject) ctx.openFile(f.file!.slice(prefix.length), f.line);
                }}
                style={({ pressed }) => [styles.frame, (i === selected || pressed) && { backgroundColor: colors.secondary }]}
              >
                <Text variant="mono" style={{ color: inProject ? colors.foreground : colors.mutedForeground }}>
                  {f.name}
                </Text>
                <Text variant="muted" numberOfLines={1}>
                  {f.file ? `${inProject ? f.file.slice(prefix.length) : f.file}:${f.line}` : 'internal'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {tab === 'console' && (
        <>
          <ScrollView style={styles.list} ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
            {lines.map((l, i) => (
              <Text
                key={i}
                variant="mono"
                style={[
                  styles.consoleLine,
                  {
                    color:
                      l.kind === 'stderr' || l.kind === 'error'
                        ? colors.destructive
                        : l.kind === 'input' || l.kind === 'info'
                          ? colors.mutedForeground
                          : l.kind === 'result'
                            ? colors.brand
                            : colors.foreground,
                  },
                ]}
              >
                {l.kind === 'input' ? `› ${l.text}` : l.text.replace(/\n$/, '')}
              </Text>
            ))}
          </ScrollView>
          <TextInput
            testID="debug-input"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submit}
            placeholder={status === 'paused' ? 'Evaluate an expression' : 'Input for the program'}
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="send"
            style={styles.input}
          />
        </>
      )}
    </Sheet>
  );
}

export const debuggerExtension: TideExtension = {
  id: 'debugger',
  editor: { breakpoints: true },
  bar: DebugBar,
  panels: [{ id: PANEL, component: DebugPanel }],
  commands: (ctx) => [
    { id: 'debugger.start', title: 'Debug: start', icon: 'crosshair', run: () => start(ctx) },
    { id: 'debugger.panel', title: 'Debug: show panel', icon: 'list', run: () => ctx.openPanel(PANEL) },
    { id: 'debugger.stop', title: 'Debug: stop', icon: 'square', run: () => debugStore.getState().stop() },
    {
      id: 'debugger.clear',
      title: 'Debug: remove all breakpoints',
      icon: 'trash-2',
      run: () => breakpointsStore.getState().clearAll(ctx.project),
    },
  ],
  activate(ctx) {
    // Leaving the project ends its debug session.
    return () => {
      if (debugStore.getState().project === ctx.project) debugStore.getState().close();
    };
  },
};

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  status: { flex: 1 },
  list: { maxHeight: 380 },
  scope: { marginTop: spacing.sm, marginBottom: spacing.xs },
  variable: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 3 },
  varName: { color: colors.brand },
  varValue: { flex: 1 },
  frame: { paddingVertical: spacing.xs + 2, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  consoleLine: { fontSize: fontSizes.xs + 1, lineHeight: 18 },
  input: {
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.foreground,
    fontFamily: fonts.mono.regular,
    fontSize: fontSizes.sm,
  },
}));
