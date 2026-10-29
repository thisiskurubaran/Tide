import { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { borderWidth, radius, spacing } from '../theme/tokens';
import { makeStyles } from '../theme/theme';
import { useModalAnimation } from './a11y';

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
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose}>
      {/* The top inset keeps the sheet below the status bar when the keyboard pushes it up. */}
      <KeyboardAvoidingView style={[styles.fill, { paddingTop: insets.top + spacing.md }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        {/* Screen readers stay inside the sheet; the escape gesture closes it. */}
        {scrollable ? (
          <View style={[styles.sheet, styles.scrollSheet]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.md }]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              {children}
            </ScrollView>
          </View>
        ) : (
          <View style={[styles.sheet, styles.content, { paddingBottom: insets.bottom + spacing.md }]} accessibilityViewIsModal onAccessibilityEscape={onClose}>
            {children}
          </View>
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
