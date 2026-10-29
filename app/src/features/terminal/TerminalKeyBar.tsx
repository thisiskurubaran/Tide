import * as Clipboard from 'expo-clipboard';

import type { IconName } from '../../components/Button';
import { KeyBar, KeyItem } from '../../components/KeyBar';
import { Trackpad } from '../../components/Trackpad';
import { ARROW_BYTES, keyFace, PASTE, terminalData, TRACKPAD } from '../keybar/catalog';
import { useKeyBar } from '../keybar/store';

// The keys come from Settings, Key bar. In the shell, the trackpad's up and
// down walk through command history, like the arrow keys.
export function TerminalKeyBar({ input, onHide }: { input(data: string): void; onHide(): void }) {
  const ids = useKeyBar((s) => s.terminal);
  const items: KeyItem[] = ids.flatMap((id): KeyItem[] => {
    const face = keyFace(id, 'terminal');
    if (!face || id === TRACKPAD) return [];
    const data = terminalData(id);
    const onPress =
      id === PASTE
        ? () =>
            Clipboard.getStringAsync()
              .then((text) => text && input(text))
              .catch(() => undefined)
        : data !== null
          ? () => input(data)
          : null;
    if (!onPress) return [];
    return [face.icon ? { a11y: face.a11y, icon: face.icon as IconName, onPress } : { a11y: face.a11y, label: face.label!, onPress }];
  });
  const trackpad = ids.includes(TRACKPAD) ? <Trackpad testID="terminal-trackpad" onStep={(d) => input(ARROW_BYTES[d])} /> : null;
  return <KeyBar testID="terminal-key-bar" groups={[items]} leading={trackpad} onHide={onHide} />;
}
