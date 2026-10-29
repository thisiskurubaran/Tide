import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';

import type { IconName } from '../../components/Button';
import { KeyBar, KeyItem } from '../../components/KeyBar';
import { Trackpad } from '../../components/Trackpad';
import { EditorAction, keyFace, PASTE, SELECT_MODE, TRACKPAD } from '../keybar/catalog';
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
// Select mode makes the arrows and the trackpad extend the selection.
export function EditorKeyBar({ send, language }: { send(msg: ToEditor): void; language: Language }) {
  const ids = useKeyBar((s) => editorKeys(s, language));
  const [selecting, setSelecting] = useState(false);
  const paste = () =>
    Clipboard.getStringAsync()
      .then((text) => text && send({ type: 'insert', text }))
      .catch(() => undefined);

  const items: KeyItem[] = ids.flatMap((id): KeyItem[] => {
    const face = keyFace(id, 'editor');
    if (!face || id === TRACKPAD) return [];
    let onPress = () => send(id.startsWith('text:') ? { type: 'insert', text: id.slice(5) } : action(id as EditorAction, selecting));
    if (id === SELECT_MODE) onPress = () => setSelecting((s) => !s);
    if (id === PASTE) onPress = paste;
    const active = id === SELECT_MODE ? selecting : undefined;
    return [face.icon ? { a11y: face.a11y, icon: face.icon as IconName, onPress, active } : { a11y: face.a11y, label: face.label!, onPress, active }];
  });
  const trackpad = ids.includes(TRACKPAD) ? <Trackpad testID="editor-trackpad" onStep={(key) => send({ type: 'key', key, select: selecting })} /> : null;
  return <KeyBar testID="keyboard-bar" groups={[items]} leading={trackpad} onHide={() => send({ type: 'blur' })} />;
}
