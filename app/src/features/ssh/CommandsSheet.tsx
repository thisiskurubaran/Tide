import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActionSheet } from '../../components/ActionSheet';
import { Button } from '../../components/Button';
import { FormSheet } from '../../components/FormSheet';
import { haptic } from '../../components/haptics';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { moveCommand, STARTER_COMMANDS, upsertCommand } from './commands';
import { SshCommand, sshStore, useSsh } from './store';

// A server's saved commands: tap one to run it in the terminal.
export function CommandsSheet({ hostId, visible, onRun, onClose }: { hostId: string; visible: boolean; onRun(c: SshCommand): void; onClose(): void }) {
  const styles = useStyles();
  const host = useSsh((s) => s.hosts.find((h) => h.id === hostId));
  const commands = host?.commands ?? [];
  const [editing, setEditing] = useState<number | null | 'new'>(null);
  const [menu, setMenu] = useState<number | null>(null);
  const save = (next: SshCommand[]) => (host ? sshStore.getState().saveHost({ ...host, commands: next }) : Promise.resolve());
  const current = typeof editing === 'number' ? commands[editing] : undefined;

  return (
    <>
      <Sheet visible={visible && editing === null && menu === null} onClose={onClose} scrollable>
        <Text variant="title">Commands</Text>
        {commands.length === 0 && (
          <>
            <Text variant="muted">Save commands you run often on this server, like restarting a service or following a log, and run them with one tap.</Text>
            <Button title="Start with examples" variant="outline" onPress={() => save(STARTER_COMMANDS)} testID="ssh-commands-examples" />
          </>
        )}
        {commands.map((c, i) => (
          <Pressable
            key={`${c.name}-${i}`}
            onPress={() => {
              haptic('tap');
              onRun(c);
              onClose();
            }}
            onLongPress={() => setMenu(i)}
            accessibilityRole="button"
            accessibilityHint="Runs it in the terminal"
            accessibilityActions={[{ name: 'longpress', label: 'Edit or delete' }]}
            onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && setMenu(i)}
            style={styles.row}
            testID={`ssh-command-${i}`}
          >
            <Text variant="label">{c.name}</Text>
            <Text variant="mono" numberOfLines={2}>
              {c.command}
            </Text>
          </Pressable>
        ))}
        {commands.length > 0 && <Text variant="muted">Touch and hold a command to edit, reorder or delete it.</Text>}
        <View style={styles.actions}>
          <Button title="Add command" variant="outline" icon="plus" onPress={() => setEditing('new')} testID="ssh-command-add" />
          <Button title="Done" onPress={onClose} />
        </View>
      </Sheet>

      <ActionSheet
        title={menu !== null ? (commands[menu]?.name ?? null) : null}
        onClose={() => setMenu(null)}
        actions={
          menu === null
            ? []
            : [
                { label: 'Edit', icon: 'edit-2', onPress: () => (setEditing(menu), setMenu(null)) },
                { label: 'Move up', icon: 'arrow-up', onPress: () => (save(moveCommand(commands, menu, -1)), setMenu(null)) },
                { label: 'Move down', icon: 'arrow-down', onPress: () => (save(moveCommand(commands, menu, 1)), setMenu(null)) },
                { label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => (save(commands.filter((_, j) => j !== menu)), setMenu(null)) },
              ]
        }
      />

      <FormSheet
        key={String(editing)}
        visible={editing !== null}
        title={editing === 'new' ? 'New command' : 'Edit command'}
        description="It's typed into this server's terminal when you tap it. Several lines run one after another."
        confirmLabel="Save"
        fields={[
          { key: 'name', label: 'Name', placeholder: 'Restart app', initial: current?.name, required: true },
          { key: 'command', label: 'Command', placeholder: 'sudo systemctl restart app', initial: current?.command, required: true, multiline: true, mono: true },
        ]}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          await save(upsertCommand(commands, editing === 'new' ? null : (editing as number), { name: v.name, command: v.command }));
          setEditing(null);
        }}
      />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: 2, padding: spacing.sm + 2, borderRadius: radius.md, borderWidth, borderColor: colors.border, backgroundColor: colors.card },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
}));
