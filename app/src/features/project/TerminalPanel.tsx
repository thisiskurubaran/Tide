import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useLocalPorts } from '../../runtime/ports';
import { useRunner } from '../../state';
import { borderWidth, fonts, fontSizes, radius, spacing } from '../../theme/tokens';
import { connectSocket, nativeSocket, previewUrl } from '../remote/api';
import { RemotePty } from '../remote/pty';
import { useRemoteSession } from '../remote/useRemoteSession';
import type { Shortcut } from './shortcuts';
import { addTab, closeTab, cycleTab, initialTabs, MAX_TERMINALS } from './terminalTabs';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
import { makeStyles, useColors } from '../../theme/theme';
import { requirePro } from '../pro';
import { FREE_LIMITS } from '../pro/plans';

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
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ project, onFocusChange, onShortcut }, ref) {
  const styles = useStyles();
  const colors = useColors();
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  const { status, ports, retry } = useRemoteSession(project, mode === 'remote');
  const [tabs, setTabs] = useState(initialTabs);
  const localPorts = useLocalPorts(project);
  const panes = useRef(new Map<number, TerminalHandle>());
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
  // More than the free number of terminals is Pro.
  const newTerminal = () => (tabs.ids.length < FREE_LIMITS.terminals || requirePro('terminals')) && setTabs(addTab);

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
            <Text variant="muted">Remote mode runs a real shell in a container on your Tide server.</Text>
            <Button title="Set up Remote" icon="server" onPress={() => router.push('/settings/remote')} testID="remote-setup" />
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
        <IconButton icon="search" label="Find in terminal output" onPress={() => (finding ? stopFinding() : setFinding(true))} testID="terminal-find" />
        <Segmented
          testID="runner"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'remote', label: 'Remote' },
          ]}
        />
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
  panel: { flex: 1, borderTopWidth: borderWidth, borderColor: colors.border, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
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
  message: { flex: 1, padding: spacing.md, gap: spacing.md, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: spacing.sm },
}));
