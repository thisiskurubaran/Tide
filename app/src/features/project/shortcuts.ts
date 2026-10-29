// Hardware keyboard shortcuts the editor and terminal WebViews pass to the
// app. Plain TypeScript: both web bundles import it. Each id matches a command
// palette id, except 'palette', which opens the palette itself.
export type TabNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type Shortcut =
  | 'quick-open'
  | 'palette'
  | 'search'
  | 'goto-line'
  | 'toggle-terminal'
  | 'save'
  | 'format'
  | 'close-tab'
  | 'next-tab'
  | 'prev-tab'
  | `tab-${TabNumber}`
  | 'files'
  | 'run'
  | 'settings'
  | 'keyboard-shortcuts'
  | 'new-terminal'
  | 'split';

type KeyEvent = { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean };

// Cmd only: in a terminal, Ctrl+L, Ctrl+P and Ctrl+J already mean something.
// Format document is Shift+Option+F, as in VS Code.
export function shortcutFor(e: KeyEvent): Shortcut | null {
  // Option changes e.key (Option-F types "ƒ"), so the physical key is checked.
  if (e.altKey && e.shiftKey && !e.metaKey && e.code === 'KeyF') return 'format';
  if (!e.metaKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.shiftKey) {
    // Shift turns [ into { and / into ?, so these go by physical key too.
    if (e.code === 'BracketLeft') return 'prev-tab';
    if (e.code === 'BracketRight') return 'next-tab';
    if (e.code === 'Slash' || key === '?') return 'keyboard-shortcuts';
    return key === 'p' ? 'palette' : key === 'f' ? 'search' : null;
  }
  if (/^[1-9]$/.test(key)) return `tab-${Number(key) as TabNumber}`;
  switch (key) {
    case 'p':
      return 'quick-open';
    case 'l':
      return 'goto-line';
    case 'j':
      return 'toggle-terminal';
    case 's':
      return 'save';
    case 'w':
      return 'close-tab';
    case 'b':
      return 'files';
    case 'r':
      return 'run';
    case 't':
      return 'new-terminal';
    case '\\':
      return 'split';
    case ',':
      return 'settings';
    default:
      return null;
  }
}

// What the Keyboard shortcuts sheet lists, app shortcuts first, then the
// editor's own (CodeMirror's default keymaps).
export const SHORTCUT_HELP: { group: string; items: [keys: string, title: string][] }[] = [
  {
    group: 'App',
    items: [
      ['⌘P', 'Open file'],
      ['⇧⌘P', 'Command palette'],
      ['⇧⌘F', 'Search in project'],
      ['⌘S', 'Save'],
      ['⌘W', 'Close file'],
      ['⇧⌘[  ⇧⌘]', 'Previous / next file'],
      ['⌘1 … ⌘9', 'Go to file 1–9'],
      ['⌘B', 'Show or hide files'],
      ['⌘J', 'Show or hide the terminal'],
      ['⌘R', 'Run the project'],
      ['⌘T', 'New terminal'],
      ['⌘\\', 'Split the editor (iPad)'],
      ['⌘L', 'Go to line'],
      ['⌘,', 'Settings'],
      ['⇧⌘?', 'Keyboard shortcuts'],
    ],
  },
  {
    group: 'Editor',
    items: [
      ['⌘F', 'Find, and replace, in the file'],
      ['⌘/', 'Comment or uncomment lines'],
      ['⌘D', 'Select the next occurrence'],
      ['⇧⌘L', 'Select all occurrences'],
      ['⌥ drag', 'Column selection, one cursor per line'],
      ['⌘ click', 'Add a cursor (go to definition with IntelliSense Pro)'],
      ['⌥↑  ⌥↓', 'Move line up / down'],
      ['⇧⌥↑  ⇧⌥↓', 'Copy line up / down'],
      ['⇧⌘K', 'Delete line'],
      ['⌘]  ⌘[', 'Indent / outdent'],
      ['⌥⌘[  ⌥⌘]', 'Fold / unfold'],
      ['⌘Z  ⇧⌘Z', 'Undo / redo'],
      ['⇧⌥F', 'Format document (Format & Lint)'],
    ],
  },
];
