import { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { makeStyles } from '../theme/theme';
import { borderWidth, radius, spacing } from '../theme/tokens';
import { useModalAnimation } from './a11y';

interface OverlayProps {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
}

// Panel that drops from the top, for the command palette and search. It sits
// above the keyboard, so results stay visible while typing.
export function Overlay({ visible, onClose, children }: OverlayProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const animation = useModalAnimation('fade');
  return (
    <Modal visible={visible} transparent animationType={animation} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.fill, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.panel} accessibilityViewIsModal onAccessibilityEscape={onClose}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.sm },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.background, opacity: 0.7 },
  panel: {
    width: '100%',
    maxWidth: 640,
    maxHeight: '60%',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
}));
