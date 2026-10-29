// Hardware keyboard shortcuts the editor and terminal WebViews pass to the
// app. Plain TypeScript: both web bundles import it. Each id matches a command
// palette id, except 'palette', which opens the palette itself.
export type Shortcut = 'quick-open' | 'palette' | 'search' | 'goto-line' | 'toggle-terminal' | 'save' | 'format';

// Cmd only: in a terminal, Ctrl+L, Ctrl+P and Ctrl+J already mean something.
// Format document is Shift+Option+F, as in VS Code.
export function shortcutFor(e: { key: string; code?: string; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Shortcut | null {
  // Option changes e.key (Option-F types "ƒ"), so the physical key is checked.
  if (e.altKey && e.shiftKey && !e.metaKey && e.code === 'KeyF') return 'format';
  if (!e.metaKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.shiftKey) return key === 'p' ? 'palette' : key === 'f' ? 'search' : null;
  switch (key) {
    case 'p':
      return 'quick-open';
    case 'l':
      return 'goto-line';
    case 'j':
      return 'toggle-terminal';
    case 's':
      return 'save';
    default:
      return null;
  }
}
