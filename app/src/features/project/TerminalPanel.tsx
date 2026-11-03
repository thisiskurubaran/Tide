import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useLocalPorts } from '../../runtime/ports';
import { useRunner, workspace } from '../../state';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { connectSocket, nativeSocket, previewUrl } from '../remote/api';
import { RemotePty } from '../remote/pty';
import { useRemoteSession } from '../remote/useRemoteSession';
import { remoteSettingsStore, useRemoteSettings } from '../remote/settings';
import type { Shortcut } from './shortcuts';
import { addTab, closeTab, cycleTab, initialTabs, MAX_TERMINALS } from './terminalTabs';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
import { createOutputCollector, OutputCollector } from '../problems/collector';
import { diagnosticsStore, useDiagnostics } from '../../extensions/diagnostics';
import { makeStyles, useColors } from '../../theme/theme';

// The panel's handle drives whichever terminal is showing, and manages tabs.
export interface TerminalPanelHandle extends TerminalHandle {
  newTerminal(): void;
  closeTerminal(): void;
  nextTerminal(): void;
}

interface TerminalPanelProps {
  project: string;
  onFocusChange(focused: boolean): void;
  onShortcut(id: Shortcut): void;
  onOpenFile?(path: string, line: number, column?: number): void;
  onShowProblems?(): void;
  // Whether the active terminal is running a command (Local mode).
  onBusyChange?(busy: boolean): void;
  // Hides the panel (the chevron in its header).
  onHide?(): void;
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ project, onFocusChange, onShortcut, onOpenFile, onShowProblems, onBusyChange, onHide }, ref) {
  const styles = useStyles();
  const colors = useColors();
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  const { status, ports, retry } = useRemoteSession(project, mode === 'remote');
  const remoteConfigured = useRemoteSettings((s) => s.settings !== null);
  useEffect(() => {
    if (!remoteSettingsStore.getState().loaded) remoteSettingsStore.getState().load().catch(() => undefined);
  }, []);
  const [tabs, setTabs] = useState(initialTabs);
  const localPorts = useLocalPorts(project);
  const panes = useRef(new Map<number, TerminalHandle>());
  // Errors and warnings across the project, from every source.
  const problemCount = useDiagnostics((s) =>
    Object.values(s.byProject[project] ?? {}).reduce((n, sources) => n + Object.values(sources).reduce((m, list) => m + list.filter((d) => d.severity !== 'info').length, 0), 0),
  );
  // Problems found in each terminal's output.
  const collectors = useRef(new Map<number, OutputCollector>());
  const collector = (id: number) => {
    let c = collectors.current.get(id);
    if (!c) {
      c = createOutputCollector({
        project,
        key: String(id),
        files: () => workspace.listFiles(project),
        readText: (path) => workspace.readFile(project, path),
        store: diagnosticsStore,
      });
      collectors.current.set(id, c);
    }
    return c;
  };
  // Find in the active terminal's output.
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ index: number; count: number } | null>(null);
  const find = (q: string, backwards = false) => {
    setQuery(q);
    panes.current.get(tabs.active)?.find(q, backwards);
  };
  const stopFinding = () => {
    setFinding(false);
    setFound(null);
    setQuery('');
    panes.current.forEach((p) => p.clearFind());
  };
  // Which terminals are running something; the active one drives Run/Stop.
  const [busyIds, setBusyIds] = useState<Set<number>>(() => new Set());
  const activeBusy = busyIds.has(tabs.active);
  useEffect(() => onBusyChange?.(activeBusy), [activeBusy, onBusyChange]);
  const newTerminal = () => tabs.ids.length < MAX_TERMINALS && setTabs(addTab);

  // A closed terminal's problems go with it.
  useEffect(() => {
    for (const [id, c] of collectors.current) {
      if (!tabs.ids.includes(id)) {
        c.reset();
        collectors.current.delete(id);
      }
    }
  }, [tabs.ids]);

  useImperativeHandle(
    ref,
    () => ({
      input: (data) => panes.current.get(tabs.active)?.input(data),
      blur: () => panes.current.get(tabs.active)?.blur(),
      find: (q, backwards) => {
        setFinding(true);
        find(q, backwards);
      },
      clearFind: stopFinding,
      recentOutput: () => panes.current.get(tabs.active)?.recentOutput() ?? '',
      newTerminal,
      closeTerminal: () => setTabs((t) => closeTab(t, t.active)),
      nextTerminal: () => setTabs((t) => cycleTab(t, 1)),
    }),
    [tabs.active, tabs.ids.length],
  );

  // Every terminal stays mounted, so a server keeps running in one while you
  // work in another; only the active one is visible and takes touches.
  const pane = (id: number, key: string, extra: Partial<React.ComponentProps<typeof TerminalPane>> = {}) => (
    <View key={key} style={[StyleSheet.absoluteFill, id === tabs.active ? styles.shown : styles.hidden]} pointerEvents={id === tabs.active ? 'auto' : 'none'}>
      <TerminalPane
        {...extra}
        ref={(h) => {
          if (h) panes.current.set(id, h);
          else panes.current.delete(id);
        }}
        project={project}
        onFocusChange={onFocusChange}
        onShortcut={onShortcut}
        onFound={(index, count) => id === tabs.active && setFound({ index, count })}
        onOpenFile={onOpenFile}
        onOutput={(data) => collector(id).write(data)}
        onSubmit={() => collector(id).reset()}
        onBusy={(busy) =>
          setBusyIds((prev) => {
            if (prev.has(id) === busy) return prev;
            const next = new Set(prev);
            if (busy) next.add(id);
            else next.delete(id);
            return next;
          })
        }
      />
    </View>
  );

  let body: React.ReactNode;
  if (mode === 'local') {
    body = tabs.ids.map((id) => pane(id, `local-${id}`));
  } else if (status.state === 'ready') {
    const { settings, session } = status;
    // Each remote terminal is its own bash in the container.
    body = tabs.ids.map((id) =>
      pane(id, `remote-${session.id}-${id}`, {
        createBackend: (write) => new RemotePty(() => connectSocket(nativeSocket, settings, session, 'pty'), write),
      }),
    );
  } else {
    body = (
      <View style={styles.message} testID={`remote-${status.state}`}>
        {status.state === 'unconfigured' && (
          <>
            <Feather name="server" size={22} color={colors.mutedForeground} />
            <Text variant="label" style={styles.center}>
              Remote isn't set up
            </Text>
            <Text variant="muted" style={styles.center}>
              Remote runs a real Linux shell, for npm builds, Docker and compilers, on a server you host. The Local terminal works without one.
            </Text>
            <View style={styles.actions}>
              <Button title="Use Local" variant="outline" icon="smartphone" onPress={() => setMode('local')} testID="remote-use-local" />
              <Button title="Set up Remote" icon="server" onPress={() => router.push('/settings/remote')} testID="remote-setup" />
            </View>
          </>
        )}
        {(status.state === 'connecting' || status.state === 'off') && <Text variant="muted">Starting the container and syncing files...</Text>}
        {status.state === 'error' && (
          <>
            <Text variant="error">{status.message}</Text>
            <View style={styles.actions}>
              <Button title="Retry" icon="refresh-cw" onPress={retry} testID="remote-retry" />
              <Button title="Settings" variant="outline" onPress={() => router.push('/settings/remote')} />
            </View>
          </>
        )}
      </View>
    );
  }

  const ready = mode === 'remote' && status.state === 'ready' ? status : null;
  // Servers started on the device are reached directly; the container's go through the server's preview proxy.
  const previews = ready
    ? ports.map((port) => ({ port, url: previewUrl(ready.settings, ready.session, port) }))
    : mode === 'local'
      ? localPorts.map((port) => ({ port, url: `http://127.0.0.1:${port}/` }))
      : [];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsScroll}>
          {tabs.ids.map((id, i) => {
            const on = id === tabs.active;
            return (
              <Pressable
                key={id}
                testID={`terminal-tab-${i + 1}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Terminal ${i + 1}`}
                onPress={() => setTabs((t) => ({ ...t, active: id }))}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Feather name="terminal" size={12} color={on ? colors.foreground : colors.mutedForeground} />
                <Text variant="label" style={{ color: on ? colors.foreground : colors.mutedForeground }}>
                  {i + 1}
                </Text>
                {on && tabs.ids.length > 1 && (
                  <Pressable accessibilityRole="button"
                    hitSlop={spacing.sm}
                    accessibilityLabel={`Close terminal ${i + 1}`}
                    testID={`terminal-close-${i + 1}`}
                    onPress={() => setTabs((t) => closeTab(t, id))}
                  >
                    <Feather name="x" size={12} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}
          {tabs.ids.length < MAX_TERMINALS && <IconButton icon="plus" label="New terminal" onPress={newTerminal} testID="terminal-new" />}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ports} style={styles.portsScroll}>
          {previews.map(({ port, url }) => (
            <Pressable
              key={port}
              testID={`preview-${port}`}
              accessibilityRole="button"
              accessibilityLabel={`Open preview of port ${port}`}
              onPress={() => router.push({ pathname: '/preview', params: { url, port: String(port), project } })}
              style={({ pressed }) => [styles.port, pressed && styles.portPressed]}
            >
              <Text variant="label" style={styles.portText}>
                :{port}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {problemCount > 0 && onShowProblems && (
          <Pressable onPress={onShowProblems} accessibilityRole="button" accessibilityLabel={`${problemCount} problems`} style={styles.problems} testID="terminal-problems">
            <Feather name="alert-triangle" size={14} color={colors.warning} />
            <Text style={styles.problemCount}>{problemCount}</Text>
          </Pressable>
        )}
        <IconButton icon="search" label="Find in terminal output" onPress={() => (finding ? stopFinding() : setFinding(true))} testID="terminal-find" />
        {/* Remote only appears once a server is set up (or was picked before). */}
        {(remoteConfigured || mode === 'remote') && (
          <Segmented
            testID="runner"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'local', label: 'Local' },
              { value: 'remote', label: 'Remote' },
            ]}
          />
        )}
        {onHide && <IconButton icon="chevron-down" label="Hide terminal" onPress={onHide} testID="terminal-hide" />}
      </View>
      {finding && (
        <View style={styles.findBar}>
          <TextInput
            value={query}
            onChangeText={(q) => find(q)}
            onSubmitEditing={() => find(query)}
            placeholder="Find in output"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="search"
            blurOnSubmit={false}
            selectionColor={colors.brand}
            style={styles.findInput}
            testID="terminal-find-input"
          />
          <Text variant="muted" style={styles.findCount}>
            {!query || !found ? '' : found.count === 0 ? 'None' : found.index >= 0 ? `${found.index + 1}/${found.count}` : `${found.count}+`}
          </Text>
          <IconButton icon="chevron-up" label="Previous match" onPress={() => find(query, true)} disabled={!query} testID="terminal-find-prev" />
          <IconButton icon="chevron-down" label="Next match" onPress={() => find(query)} disabled={!query} testID="terminal-find-next" />
          <IconButton icon="x" label="Close find" onPress={stopFinding} />
        </View>
      )}
      <View style={styles.body}>{body}</View>
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  problems: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, minHeight: 32, borderRadius: radius.md },
  problemCount: { fontFamily: fonts.mono.regular, fontSize: fontSizes.sm, color: colors.foreground },
  panel: { flex: 1, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 36,
    borderBottomWidth: borderWidth,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  portsScroll: { flex: 1 },
  findBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderBottomWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  findInput: { flex: 1, height: 40, color: colors.foreground, fontFamily: fonts.mono.regular, fontSize: fontSizes.sm },
  findCount: { minWidth: 44, textAlign: 'right' },
  ports: { gap: spacing.xs, alignItems: 'center' },
  port: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth, borderColor: colors.brand },
  portPressed: { backgroundColor: colors.secondary },
  portText: { color: colors.brand },
  body: { flex: 1 },
  shown: { opacity: 1, zIndex: 1 },
  hidden: { opacity: 0, zIndex: 0 },
  tabsScroll: { flexGrow: 0, maxWidth: '50%' },
  tabs: { alignItems: 'center', gap: spacing.xs },
  tab: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  tabOn: { backgroundColor: colors.secondary },
  message: { flex: 1, padding: spacing.lg, gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', maxWidth: 420 },
  actions: { flexDirection: 'row', gap: spacing.sm },
}));
