import { router } from 'expo-router';
import { forwardRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Segmented } from '../../components/Segmented';
import { Text } from '../../components/Text';
import { useRunner } from '../../state';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { connectSocket, nativeSocket, previewUrl } from '../remote/api';
import { RemotePty } from '../remote/pty';
import { useRemoteSession } from '../remote/useRemoteSession';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
import { makeStyles } from '../../theme/theme';

interface TerminalPanelProps {
  project: string;
  onFocusChange(focused: boolean): void;
}

export const TerminalPanel = forwardRef<TerminalHandle, TerminalPanelProps>(function TerminalPanel({ project, onFocusChange }, ref) {
  const styles = useStyles();
  const mode = useRunner((s) => s.mode);
  const setMode = useRunner((s) => s.setMode);
  const { status, ports, retry } = useRemoteSession(project, mode === 'remote');

  let body: React.ReactNode;
  if (mode === 'local') {
    body = <TerminalPane key="local" ref={ref} project={project} onFocusChange={onFocusChange} />;
  } else if (status.state === 'ready') {
    const { settings, session } = status;
    body = (
      <TerminalPane
        key={`remote-${session.id}`}
        ref={ref}
        project={project}
        onFocusChange={onFocusChange}
        createBackend={(write) => new RemotePty(() => connectSocket(nativeSocket, settings, session, 'pty'), write)}
      />
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
        <Text variant="label">Terminal</Text>
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
  message: { flex: 1, padding: spacing.md, gap: spacing.md, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', gap: spacing.sm },
}));
