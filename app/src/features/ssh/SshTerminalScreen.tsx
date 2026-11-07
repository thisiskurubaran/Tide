import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { IconButton } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { localRunner } from '../../runtime';
import { useKeyboardHeight } from '../editor/useKeyboardHeight';
import { TerminalKeyBar } from '../terminal/TerminalKeyBar';
import { TerminalHandle, TerminalPane } from '../terminal/TerminalPane';
import { SshBackend } from './client';
import { commandInput } from './commands';
import { CommandsSheet } from './CommandsSheet';
import { connectionConfig, rememberKey, sshStore, useSsh } from './store';

export function SshTerminalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const host = useSsh((s) => s.hosts.find((h) => h.id === id));
  const loaded = useSsh((s) => s.loaded);
  const terminal = useRef<TerminalHandle>(null);
  const keyboard = useKeyboardHeight();
  const [commands, setCommands] = useState(false);

  if (!host) return <Screen title="SSH">{loaded ? <Text variant="muted">This server was removed.</Text> : null}</Screen>;
  return (
    <Screen
      title={host.name}
      subtitle={`${host.username}@${host.host}`}
      scroll={false}
      actions={<IconButton icon="zap" label="Saved commands" onPress={() => setCommands(true)} testID="ssh-commands" />}
      testID="ssh-terminal"
    >
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
              (fingerprint, which) => rememberKey(host, fingerprint, which),
            )
          }
        />
      </View>
      {keyboard > 0 && (
        <View style={{ paddingBottom: keyboard }}>
          <TerminalKeyBar input={(data) => terminal.current?.input(data)} onHide={() => terminal.current?.blur()} />
        </View>
      )}
      <CommandsSheet hostId={host.id} visible={commands} onRun={(c) => terminal.current?.input(commandInput(c))} onClose={() => setCommands(false)} />
    </Screen>
  );
}
