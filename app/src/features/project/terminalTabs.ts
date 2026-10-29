// Which terminals a project has open. Each tab is a separate shell (a local
// mini-shell or its own remote bash), numbered from 1 like most editors.
export interface TerminalTabs {
  ids: number[];
  active: number;
  next: number;
}

export const MAX_TERMINALS = 6;

export const initialTabs = (): TerminalTabs => ({ ids: [1], active: 1, next: 2 });

export function addTab(t: TerminalTabs): TerminalTabs {
  if (t.ids.length >= MAX_TERMINALS) return t;
  return { ids: [...t.ids, t.next], active: t.next, next: t.next + 1 };
}

// Closing the last one starts a fresh shell, so the panel is never empty.
export function closeTab(t: TerminalTabs, id: number): TerminalTabs {
  const i = t.ids.indexOf(id);
  if (i === -1) return t;
  const ids = t.ids.filter((x) => x !== id);
  if (!ids.length) return { ids: [t.next], active: t.next, next: t.next + 1 };
  const active = t.active === id ? ids[Math.min(i, ids.length - 1)] : t.active;
  return { ...t, ids, active };
}

export function cycleTab(t: TerminalTabs, step: number): TerminalTabs {
  const i = t.ids.indexOf(t.active);
  return { ...t, active: t.ids[(i + step + t.ids.length) % t.ids.length] };
}
