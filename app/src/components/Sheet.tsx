import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { borderWidth, radius, spacing } from '../theme/tokens';
import { makeStyles } from '../theme/theme';
import { useModalAnimation } from './a11y';

interface SheetProps {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
}

// Bottom sheet used for prompts and action menus. Tapping the backdrop closes it.
export function Sheet({ visible, onClose, children }: SheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation('fade');
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        {/* Screen readers stay inside the sheet; the escape gesture closes it. */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, opacity: 0.7 },
  sheet: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderTopWidth: borderWidth,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
  },
}));
