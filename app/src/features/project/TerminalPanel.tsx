import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, IconButton } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useRunner } from '../../state';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { connectSocket, nativeSocket, previewUrl } from '../remote/api';
import { RemotePty } from '../remote/pty';
import { useRemoteSession } from '../remote/useRemoteSession';
import type { Shortcut } from './shortcuts';
import { addTab, closeTab, cycleTab, initialTabs, MAX_TERMINALS } from './terminalTabs';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
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
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ project, onFocusChange, onShortcut }, ref) {
  const styles = useStyles();
  const colors = useColors();
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  const { status, ports, retry } = useRemoteSession(project, mode === 'remote');
  const [tabs, setTabs] = useState(initialTabs);
  const panes = useRef(new Map<number, TerminalHandle>());

  useImperativeHandle(
    ref,
    () => ({
      input: (data) => panes.current.get(tabs.active)?.input(data),
      blur: () => panes.current.get(tabs.active)?.blur(),
      newTerminal: () => setTabs(addTab),
      closeTerminal: () => setTabs((t) => closeTab(t, t.active)),
      nextTerminal: () => setTabs((t) => cycleTab(t, 1)),
    }),
    [tabs.active],
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
                  <Pressable
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
          {tabs.ids.length < MAX_TERMINALS && <IconButton icon="plus" label="New terminal" onPress={() => setTabs(addTab)} testID="terminal-new" />}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ports} style={styles.portsScroll}>
          {ready &&
            ports.map((port) => (
              <Pressable
                key={port}
                testID={`preview-${port}`}
                accessibilityRole="button"
                accessibilityLabel={`Open preview of port ${port}`}
                onPress={() => router.push({ pathname: '/preview', params: { url: previewUrl(ready.settings, ready.session, port), port: String(port) } })}
                style={({ pressed }) => [styles.port, pressed && styles.portPressed]}
              >
                <Text variant="label" style={styles.portText}>
                  :{port}
                </Text>
              </Pressable>
            ))}
        </ScrollView>
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
