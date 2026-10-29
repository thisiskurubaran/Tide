import { ScrollView, View } from 'react-native';

import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import { SHORTCUT_HELP } from './shortcuts';

// Every hardware keyboard shortcut, opened with Shift-Cmd-? or from the palette.
export function ShortcutsSheet({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const styles = useStyles();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text variant="title">Keyboard shortcuts</Text>
      <ScrollView style={styles.list}>
        {SHORTCUT_HELP.map(({ group, items }) => (
          <View key={group} style={styles.group}>
            <Text variant="label">{group}</Text>
            {items.map(([keys, title]) => (
              <View key={keys} style={styles.row}>
                <Text variant="mono" style={styles.keys}>
                  {keys}
                </Text>
                <Text variant="muted" style={styles.title}>
                  {title}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 520 },
  group: { gap: spacing.xs, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, paddingVertical: 2 },
  keys: { width: 110 },
  title: { flex: 1 },
}));
