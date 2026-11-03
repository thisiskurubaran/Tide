import { ReactNode, useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { borderWidth, radius, spacing } from '../theme/tokens';
import { makeStyles } from '../theme/theme';
import { useModalAnimation, useReduceMotion } from './a11y';

interface SheetProps {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
  // Scroll the content when it's taller than the space left, e.g. above the
  // keyboard. Off for sheets that scroll a list of their own.
  scrollable?: boolean;
}

// Bottom sheet used for prompts and action menus. Tapping the backdrop closes it.
export function Sheet({ visible, onClose, children, scrollable = false }: SheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation('fade');
  // The backdrop fades while the sheet itself rises on a spring.
  const reduceMotion = useReduceMotion();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduceMotion) rise.setValue(1);
    else {
      rise.setValue(0);
      Animated.spring(rise, { toValue: 1, damping: 22, stiffness: 240, mass: 0.8, useNativeDriver: true }).start();
    }
  }, [visible, reduceMotion, rise]);
  const lift = { transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] };
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose}>
      {/* The top inset keeps the sheet below the status bar when the keyboard pushes it up. */}
      <KeyboardAvoidingView style={[styles.fill, { paddingTop: insets.top + spacing.md }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        {/* Screen readers stay inside the sheet; the escape gesture closes it. */}
        {scrollable ? (
          <Animated.View style={[styles.sheet, styles.scrollSheet, lift]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.md }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.sheet, styles.content, { paddingBottom: insets.bottom + spacing.md }, lift]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            {children}
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, opacity: 0.7 },
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderTopWidth: borderWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  scrollSheet: { overflow: 'hidden' },
  scroll: { flexGrow: 0 },
  content: { padding: spacing.md, gap: spacing.md },
}));
