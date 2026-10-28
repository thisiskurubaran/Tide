import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, Platform } from 'react-native';

// Height of the on-screen keyboard, 0 when hidden. iOS fires "will" events so
// the layout moves with the keyboard animation; Android only has "did".
export function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(show, (e: KeyboardEvent) => setHeight(e.endCoordinates.height)),
      Keyboard.addListener(hide, () => setHeight(0)),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);
  return height;
}
