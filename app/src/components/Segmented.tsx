import { Pressable, View } from 'react-native';

import { makeStyles, useColors } from '../theme/theme';
import { radius, spacing } from '../theme/tokens';
import { Text } from './Text';

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  testID?: string;
}

export function Segmented<T extends string>({ options, value, onChange, testID }: SegmentedProps<T>) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.group} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Pressable
          key={o.value}
          testID={testID ? `${testID}-${o.value}` : undefined}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={[styles.option, value === o.value && styles.optionOn]}
        >
          <Text variant="label" style={{ color: value === o.value ? colors.foreground : colors.mutedForeground }}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  group: { flexDirection: 'row', backgroundColor: colors.secondary, borderRadius: radius.sm, padding: 2, alignSelf: 'flex-start' },
  option: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.sm - 2 },
  optionOn: { backgroundColor: colors.background },
}));
