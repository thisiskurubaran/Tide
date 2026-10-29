import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';

import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
import { SshBackend } from './client';
import { connectionConfig, sshStore, useSsh } from './store';

export function SshTerminalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useSsh((s) => s.hosts.find((h) => h.id === id));
  const loaded = useSsh((s) => s.loaded);
  const terminal = useRef<TerminalHandle>(null);
  const keyboard = useKeyboardHeight();

  if (!host) return <Screen title="SSH">{loaded ? <Text variant="muted">This server was removed.</Text> : null}</Screen>;
  return (
    <Screen title={host.name} subtitle={`${host.username}@${host.host}`} scroll={false} testID="ssh-terminal">
      <View style={{ flex: 1 }}>
        <TerminalPane
          ref={terminal}
          project=""
          onFocusChange={() => undefined}
          onShortcut={() => undefined}
          createBackend={(write) =>
            new SshBackend(
              localRunner,
              `${host.username}@${host.host}`,
              () => connectionConfig(sshStore.getState().hosts.find((h) => h.id === id) ?? host),
              write,
              (fingerprint) => sshStore.getState().trustHost(host.id, fingerprint),
            )
          }
        />
      </View>
      {keyboard > 0 && (
        <View style={{ paddingBottom: keyboard }}>
          <TerminalKeyBar input={(data) => terminal.current?.input(data)} onHide={() => terminal.current?.blur()} />
        </View>
      )}
    </Screen>
  );
}
