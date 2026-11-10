import { Icon } from '../../components/Icon';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { spacing } from '../../theme/tokens';
import type { Release } from './changelog';

export function WhatsNewSheet({ releases, onClose }: { releases: Release[] | null; onClose(): void }) {
  const styles = useStyles();
  return (
    <Sheet visible={!!releases?.length} onClose={onClose}>
      <Text variant="title">What's new</Text>
      <ScrollView style={styles.list}>
        {releases?.map((r) => (
          <ReleaseNotes key={r.version} release={r} />
        ))}
      </ScrollView>
      <Button title="Done" onPress={onClose} testID="whats-new-done" />
    </Sheet>
  );
}

// A big release shows its highlights, with the full list one tap away.
function ReleaseNotes({ release }: { release: Release }) {
  const styles = useStyles();
  const colors = useColors();
  const [all, setAll] = useState(!release.highlights?.length);
  const items = all ? release.items : (release.highlights ?? []);
  return (
    <View style={styles.release}>
      <Text variant="label">Tide {release.version}</Text>
      {items.map((item) => (
        <View key={item} style={styles.item}>
          <Icon name="check" size={14} color={colors.brand} style={styles.check} />
          <Text style={styles.flex}>{item}</Text>
        </View>
      ))}
      {!all && (
        <Pressable
          onPress={() => setAll(true)}
          accessibilityRole="button"
          hitSlop={8}
          testID={`whats-new-all-${release.version}`}
        >
          <Text style={{ color: colors.brand }}>See all {release.items.length} changes</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: 420 },
  release: { gap: spacing.sm, paddingBottom: spacing.md },
  item: { flexDirection: 'row', gap: spacing.sm },
  check: { marginTop: 3 },
  flex: { flex: 1 },
}));
