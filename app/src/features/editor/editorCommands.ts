// Palette commands for the open file's text: line commands, Copy selection
// as Markdown and Share selection as image. They are sent to the editor,
// which acts on its selection.
import type { RefObject } from 'react';

import type { Command } from '../search/CommandPalette';
import type { LineCommand, ToEditor } from './bridge';

type Sender = RefObject<{ send(msg: ToEditor): void } | null>;

const LINES: { command: LineCommand; title: string; icon: Command['icon']; hint?: string }[] = [
  { command: 'sortAsc', title: 'Sort lines ascending', icon: 'arrow-down' },
  { command: 'sortDesc', title: 'Sort lines descending', icon: 'arrow-up' },
  { command: 'reverse', title: 'Reverse lines', icon: 'repeat' },
  { command: 'join', title: 'Join lines', icon: 'minimize-2', hint: '⌃J' },
  { command: 'duplicate', title: 'Duplicate line or selection', icon: 'copy', hint: '⇧⌥↓' },
  { command: 'deleteLine', title: 'Delete line', icon: 'trash-2', hint: '⇧⌘K' },
  { command: 'upper', title: 'Transform to uppercase', icon: 'type' },
  { command: 'lower', title: 'Transform to lowercase', icon: 'type' },
  { command: 'title', title: 'Transform to title case', icon: 'type' },
];

export function editorCommands(editor: Sender, hasFile: boolean): Command[] {
  if (!hasFile) return [];
  const send = (msg: ToEditor) => editor.current?.send(msg);
  return [
    ...LINES.map(({ command, title, icon, hint }) => ({ id: `lines.${command}`, title, icon, ...(hint ? { hint } : {}), run: () => send({ type: 'lines', command }) })),
    { id: 'copy-markdown', title: 'Copy selection as Markdown', icon: 'clipboard', run: () => send({ type: 'copyMarkdown' }) },
    { id: 'share-image', title: 'Share selection as image', icon: 'image', run: () => send({ type: 'shareImage', lineNumbers: true }) },
    { id: 'share-image.plain', title: 'Share selection as image (no line numbers)', icon: 'image', run: () => send({ type: 'shareImage', lineNumbers: false }) },
  ];
}
