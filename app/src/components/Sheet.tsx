import { ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { FormSheet as NativeFormSheet } from 'react-native-screens/experimental';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { borderWidth, radius, spacing } from '../theme/tokens';
import { makeStyles, useColors } from '../theme/theme';
import { useModalAnimation, useReduceMotion } from './a11y';
import { useLiquidGlass } from './Glass';
import { useSheetPresentation } from './sheetPresentation';

interface SheetProps {
  visible: boolean;
  onClose(): void;
  children: ReactNode;
  // Scroll the content when it's taller than the space left, e.g. above the
  // keyboard. Off for sheets that scroll a list of their own.
  scrollable?: boolean;
}

// iPhone gets UIKit's own sheet (the Liquid Glass sheet on iOS 26). iPad
// keeps the drawn sheet: in a regular-width window UIKit ignores detents and
// shows a fixed-size form sheet, which leaves a short menu floating in a
// mostly empty card. Android has no native equivalent.
const nativeSheets = Platform.OS === 'ios' && !Platform.isPad;

// Bottom sheet used for prompts and action menus. Swiping it down or tapping
// outside closes it.
export function Sheet(props: SheetProps) {
  return nativeSheets ? <NativeSheet {...props} /> : <ModalSheet {...props} />;
}

// Room UIKit leaves above a full-height sheet, plus the grabber.
const SHEET_TOP_GAP = 24;

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

// UISheetPresentationController sized to its content. UIKit draws the
// background, grabber, corners and dimming, moves the sheet above the
// keyboard and adds the bottom safe area itself, so there's no backdrop,
// spring, KeyboardAvoidingView or inset padding here.
function NativeSheet({ visible, onClose, children, scrollable = false }: SheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const glass = useLiquidGlass();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  // Swiped away while the caller still says visible (until it handles onClose).
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!visible) setDismissed(false);
  }, [visible]);
  const sheet = useSheetPresentation(visible && !dismissed);
  if (!sheet.mounted) return null;

  // The content view is as tall as its content, so a long form needs its own
  // cap to scroll instead of running off the bottom of the sheet.
  const maxHeight = window.height - insets.top - SHEET_TOP_GAP - Math.max(keyboard, insets.bottom);
  return (
    <NativeFormSheet
      isOpen={sheet.isOpen}
      detents="fitToContents"
      prefersGrabberVisible
      preferredCornerRadius="systemDefault"
      prefersScrollingExpandsWhenScrolledToEdge={false}
      // Clear lets the system's glass sheet show on iOS 26; older systems,
      // Reduce Transparency and high contrast get the app's card colour.
      nativeContainerStyle={{ backgroundColor: glass ? 'transparent' : colors.card }}
      onDidAppear={sheet.onDidAppear}
      onDidDisappear={sheet.onDidDisappear}
      onNativeDismiss={() => {
        sheet.onNativeDismiss();
        setDismissed(true);
        onClose();
      }}
    >
      {/* Screen readers stay inside the sheet; the escape gesture closes it. */}
      <View accessibilityViewIsModal onAccessibilityEscape={onClose} testID="sheet">
        {scrollable ? (
          <ScrollView
            style={[styles.scroll, { maxHeight }]}
            contentContainerStyle={[styles.content, styles.nativeContent]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.nativeContent]}>{children}</View>
        )}
      </View>
    </NativeFormSheet>
  );
}

// A transparent Modal with a dimmed backdrop and a card that rises on a spring.
function ModalSheet({ visible, onClose, children, scrollable = false }: SheetProps) {
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
  // Clear of the system grabber at the top.
  nativeContent: { paddingTop: spacing.md + spacing.sm },
}));
