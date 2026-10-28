import { KeyBar, KeyItem } from '../../components/KeyBar';
import type { ToEditor } from './bridge';

const CHARS: [string, string][] = [
  ['{', 'Open brace'],
  ['}', 'Close brace'],
  ['(', 'Open parenthesis'],
  [')', 'Close parenthesis'],
  ['[', 'Open bracket'],
  [']', 'Close bracket'],
  [';', 'Semicolon'],
  [':', 'Colon'],
  ['"', 'Double quote'],
  ["'", 'Single quote'],
  ['=', 'Equals'],
  ['<', 'Less than'],
  ['>', 'Greater than'],
  ['/', 'Slash'],
  ['\\', 'Backslash'],
];

export function EditorKeyBar({ send }: { send(msg: ToEditor): void }) {
  const arrows: KeyItem[] = [
    { icon: 'arrow-left', a11y: 'Cursor left', onPress: () => send({ type: 'key', key: 'left' }) },
    { icon: 'arrow-up', a11y: 'Cursor up', onPress: () => send({ type: 'key', key: 'up' }) },
    { icon: 'arrow-down', a11y: 'Cursor down', onPress: () => send({ type: 'key', key: 'down' }) },
    { icon: 'arrow-right', a11y: 'Cursor right', onPress: () => send({ type: 'key', key: 'right' }) },
  ];
  const chars: KeyItem[] = [
    { label: '⇥', a11y: 'Tab', onPress: () => send({ type: 'key', key: 'tab' }) },
    ...CHARS.map(([c, a11y]): KeyItem => ({ label: c, a11y, onPress: () => send({ type: 'insert', text: c }) })),
  ];
  const actions: KeyItem[] = [
    { icon: 'corner-up-left', a11y: 'Undo', onPress: () => send({ type: 'undo' }) },
    { icon: 'corner-up-right', a11y: 'Redo', onPress: () => send({ type: 'redo' }) },
    { icon: 'search', a11y: 'Find', onPress: () => send({ type: 'find' }) },
  ];
  return <KeyBar testID="keyboard-bar" groups={[arrows, chars, actions]} onHide={() => send({ type: 'blur' })} />;
}
