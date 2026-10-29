import { KeyBar, KeyItem } from '../../components/KeyBar';
import type { IconName } from '../../components/Button';
import { EditorAction, keyFace } from '../keybar/catalog';
import { editorKeys, useKeyBar } from '../keybar/store';
import type { Language, ToEditor } from './bridge';

function action(id: EditorAction): ToEditor {
  switch (id) {
    case 'undo':
    case 'redo':
    case 'find':
    case 'complete':
      return { type: id };
    default:
      return { type: 'key', key: id };
  }
}

// The keys come from Settings, Key bar: per language, or the default list.
export function EditorKeyBar({ send, language }: { send(msg: ToEditor): void; language: Language }) {
  const ids = useKeyBar((s) => editorKeys(s, language));
  const items: KeyItem[] = ids.flatMap((id): KeyItem[] => {
    const face = keyFace(id, 'editor');
    if (!face) return [];
    const onPress = () => send(id.startsWith('text:') ? { type: 'insert', text: id.slice(5) } : action(id as EditorAction));
    return [face.icon ? { a11y: face.a11y, icon: face.icon as IconName, onPress } : { a11y: face.a11y, label: face.label!, onPress }];
  });
  return <KeyBar testID="keyboard-bar" groups={[items]} onHide={() => send({ type: 'blur' })} />;
}
