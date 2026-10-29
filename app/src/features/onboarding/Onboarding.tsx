import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/Button';
import { haptic } from '../../components/haptics';
import { Text } from '../../components/Text';
import { makeStyles, useColors } from '../../theme/theme';
import { borderWidth, radius, spacing } from '../../theme/tokens';
import { STEPS } from './steps';
import { useModalAnimation } from '../../components/a11y';

interface OnboardingProps {
  visible: boolean;
  // `create` when the last step's button was used, to start a first project.
  onDone(create: boolean): void;
}

export function Onboarding({ visible, onDone }: OnboardingProps) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation('fade');
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  return (
    <Modal visible={visible} animationType={animation} onRequestClose={() => onDone(false)} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.top}>
          {index > 0 && (
            <Pressable
              onPress={() => setIndex(index - 1)}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
              style={styles.back}
              testID="onboarding-back"
            >
              <Feather name="chevron-left" size={18} color={colors.mutedForeground} />
              <Text variant="muted">Back</Text>
            </Pressable>
          )}
          <View style={styles.flex} />
          {!last && (
            <Pressable onPress={() => onDone(false)} accessibilityRole="button" hitSlop={12} testID="onboarding-skip">
              <Text variant="muted">Skip</Text>
            </Pressable>
          )}
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.content} accessible accessibilityLabel={`Step ${index + 1} of ${STEPS.length}. ${step.title}. ${step.body}`}>
            <View style={styles.icon}>
              <Feather name={step.icon} size={40} color={colors.brand} />
            </View>
            <Text variant="heading" style={styles.center}>
              {step.title}
            </Text>
            <Text style={[styles.center, styles.body]}>{step.body}</Text>
            <View style={styles.tips}>
              {step.tips.map((tip) => (
                <View key={tip} style={styles.tip}>
                  <Text variant="muted">{tip}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
        <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {STEPS.map((s, i) => (
            <View key={s.title} style={[styles.dot, i === index && { backgroundColor: colors.brand, width: 18 }]} />
          ))}
        </View>
        {/* Full-width and stacked, so the buttons fit narrow phones and large text sizes. */}
        <View style={styles.actions}>
          {last ? (
            <>
              <Button
                title="Create a project"
                icon="plus"
                onPress={() => {
                  haptic('success');
                  onDone(true);
                }}
                testID="onboarding-create"
              />
              <Button title="Explore first" variant="outline" onPress={() => onDone(false)} testID="onboarding-explore" />
            </>
          ) : (
            <Button
              title="Next"
              onPress={() => {
                haptic('select');
                setIndex(index + 1);
              }}
              testID="onboarding-next"
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  top: { minHeight: 32, flexDirection: 'row', alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // Centred when it fits; scrolls when a large text size makes a step taller than the screen.
  scroll: { flexGrow: 1, justifyContent: 'center' },
  content: { alignItems: 'center', gap: spacing.md, maxWidth: 520, alignSelf: 'center', paddingVertical: spacing.md },
  icon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandSoft, marginBottom: spacing.sm },
  center: { textAlign: 'center' },
  body: { color: colors.mutedForeground, lineHeight: 22 },
  tips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  tip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth, borderColor: colors.border },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: spacing.lg },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  actions: { gap: spacing.sm, width: '100%', maxWidth: 520, alignSelf: 'center' },
  flex: { flex: 1 },
}));
