import type { IconName } from '../../components/Button';
import { KeyBar, KeyItem } from '../../components/KeyBar';
import { keyFace, terminalData } from '../keybar/catalog';
import { useKeyBar } from '../keybar/store';

// The keys come from Settings, Key bar.
export function TerminalKeyBar({ input, onHide }: { input(data: string): void; onHide(): void }) {
  const ids = useKeyBar((s) => s.terminal);
  const items: KeyItem[] = ids.flatMap((id): KeyItem[] => {
    const face = keyFace(id, 'terminal');
    const data = terminalData(id);
    if (!face || data === null) return [];
    const onPress = () => input(data);
    return [face.icon ? { a11y: face.a11y, icon: face.icon as IconName, onPress } : { a11y: face.a11y, label: face.label!, onPress }];
  });
  return <KeyBar testID="terminal-key-bar" groups={[items]} onHide={onHide} />;
}
