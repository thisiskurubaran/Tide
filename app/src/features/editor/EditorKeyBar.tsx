import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import type { IconName } from '../../components/Button';
import { KeyBar, KeyItem, KeyVariant } from '../../components/KeyBar';
import { Trackpad } from '../../components/Trackpad';
import { EditorAction, KEY_VARIANTS, keyFace, PASTE, SELECT_MODE, symbolName, SymbolVariant, TRACKPAD } from '../keybar/catalog';
import { editorKeys, useKeyBar } from '../keybar/store';
import type { Language, ToEditor } from './bridge';

function action(id: EditorAction, select: boolean): ToEditor {
  switch (id) {
    case 'undo':
    case 'redo':
    case 'find':
    case 'complete':
      return { type: id };
    case 'select-word':
      return { type: 'select', unit: 'word' };
    case 'select-line':
      return { type: 'select', unit: 'line' };
    case 'select-all':
      return { type: 'select', unit: 'all' };
    case 'expand':
      return { type: 'select', unit: 'expand' };
    case 'copy':
    case 'cut':
      return { type: 'copy', cut: id === 'cut' };
    default:
      return { type: 'key', key: id, select };
  }
}

// The keys come from Settings, Key bar: per language, or the default list.
// Select mode makes the arrows, the trackpad and swipes extend the selection.
// Holding a symbol offers its variants; a pair like () leaves the caret inside.
// While an AI suggestion shows (`completion`), Accept, Word and Next lead the row.
export function EditorKeyBar({ send, language, completion }: { send(msg: ToEditor): void; language: Language; completion?: boolean }) {
  const ids = useKeyBar((s) => editorKeys(s, language));
  const [selecting, setSelecting] = useState(false);
  const paste = () =>
    Clipboard.getStringAsync()
      .then((text) => text && send({ type: 'insert', text }))
      .catch(() => undefined);
  const variant = ({ text, cursor }: SymbolVariant): KeyVariant => ({
    label: text,
    a11y: symbolName(text),
    onPress: () => send({ type: 'insertLiteral', text, cursor }),
  });

  const items: KeyItem[] = ids.flatMap((id): KeyItem[] => {
    const face = keyFace(id, 'editor');
    if (!face || id === TRACKPAD) return [];
    let onPress = () => send(id.startsWith('text:') ? { type: 'insert', text: id.slice(5) } : action(id as EditorAction, selecting));
    if (id === SELECT_MODE) onPress = () => setSelecting((s) => !s);
    if (id === PASTE) onPress = paste;
    const active = id === SELECT_MODE ? selecting : undefined;
    const variants = id.startsWith('text:') ? KEY_VARIANTS[id.slice(5)]?.map(variant) : undefined;
    const common = { a11y: face.a11y, onPress, active, variants };
    return [face.icon ? { ...common, icon: face.icon as IconName } : { ...common, label: face.label! }];
  });
  const trackpad = ids.includes(TRACKPAD) ? <Trackpad testID="editor-trackpad" onStep={(key) => send({ type: 'key', key, select: selecting })} /> : null;
  const suggestion: KeyItem[] = [
    { label: '⇥ Accept', a11y: 'Accept suggestion', tone: 'brand', testID: 'completion-accept', onPress: () => send({ type: 'acceptCompletion', part: 'all' }) },
    { label: 'Word', a11y: 'Accept next word of suggestion', testID: 'completion-word', onPress: () => send({ type: 'acceptCompletion', part: 'word' }) },
    { label: 'Next ↓', a11y: 'Next suggestion', testID: 'completion-next', onPress: () => send({ type: 'nextCompletion' }) },
  ];
  return (
    <KeyBar
      testID="keyboard-bar"
      groups={completion ? [suggestion, items] : [items]}
      leading={trackpad}
      onSwipe={(by) => send({ type: 'moveCursor', by, select: selecting })}
      onHide={() => send({ type: 'blur' })}
    />
  );
}
