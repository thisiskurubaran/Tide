import { KeyBar, KeyItem } from '../../components/KeyBar';

// Bytes a hardware keyboard would send for each key.
const ESC = '\x1b';

export function TerminalKeyBar({ input, onHide }: { input(data: string): void; onHide(): void }) {
  const control: KeyItem[] = [
    { label: 'esc', a11y: 'Escape', onPress: () => input(ESC) },
    { label: '⇥', a11y: 'Tab', onPress: () => input('\t') },
    { label: '^C', a11y: 'Control C', onPress: () => input('\x03') },
    { label: '^L', a11y: 'Clear screen', onPress: () => input('\x0c') },
  ];
  const arrows: KeyItem[] = [
    { icon: 'arrow-left', a11y: 'Cursor left', onPress: () => input(`${ESC}[D`) },
    { icon: 'arrow-up', a11y: 'Previous command', onPress: () => input(`${ESC}[A`) },
    { icon: 'arrow-down', a11y: 'Next command', onPress: () => input(`${ESC}[B`) },
    { icon: 'arrow-right', a11y: 'Cursor right', onPress: () => input(`${ESC}[C`) },
  ];
  const chars: KeyItem[] = (
    [
      ['/', 'Slash'],
      ['-', 'Dash'],
      ['~', 'Tilde'],
      ['.', 'Dot'],
      ['|', 'Pipe'],
      ['>', 'Greater than'],
      ['"', 'Double quote'],
      ["'", 'Single quote'],
      ['*', 'Star'],
      ['_', 'Underscore'],
    ] as const
  ).map(([c, a11y]) => ({ label: c, a11y, onPress: () => input(c) }));
  return <KeyBar testID="terminal-key-bar" groups={[control, arrows, chars]} onHide={onHide} />;
}
