import Feather from '@expo/vector-icons/Feather';
import { ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import type { Release } from './changelog';

export function WhatsNewSheet({ releases, onClose }: { releases: Release[] | null; onClose(): void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Sheet visible={!!releases?.length} onClose={onClose}>
      <Text variant="title">What's new</Text>
      <ScrollView style={styles.list}>
        {releases?.map((r) => (
          <View key={r.version} style={styles.release}>
            <Text variant="label">Tide {r.version}</Text>
            {r.items.map((item) => (
              <View key={item} style={styles.item}>
                <Feather name="check" size={14} color={colors.brand} style={styles.check} />
                <Text style={styles.flex}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      <Button title="Done" onPress={onClose} testID="whats-new-done" />
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 420 },
  release: { gap: spacing.sm, paddingBottom: spacing.md },
  item: { flexDirection: 'row', gap: spacing.sm },
  check: { marginTop: 3 },
  flex: { flex: 1 },
}));
