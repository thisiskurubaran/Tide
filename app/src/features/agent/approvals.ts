// "Always allow" for the agent's commands (e.g. every npm command), per
// project, kept across launches. Saved with the project's identity (see
// projectIdentity.ts) so a different project that later gets the same name
// doesn't inherit them; moved on rename, cleared on delete, and revocable from
// Settings, AI assistant.
import type { StateStorage } from 'zustand/middleware';

import { Identify, identityReliable, sameProject } from './projectIdentity';

export const APPROVALS_KEY = 'agent-approvals';
// Before approvals had an identity: { [project]: string[] }.
export const LEGACY_APPROVALS_KEY = 'agent-allow';

interface Entry {
  id: string;
  keys: string[];
}
type Saved = Record<string, Entry>;

export function createApprovals(storage: StateStorage, identify: Identify = async () => '') {
  let cache: Saved | null = null;
  // Where identities can't be trusted (Android, see projectIdentity.ts) none is
  // kept or compared: approvals match by name, and go with a delete or rename.
  const trusted = () => identityReliable(identify);
  const known = async (project: string) => {
    const id = await identify(project);
    return id === null ? null : trusted() ? id : '';
  };
  // Changes run one after another so none is lost.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.catch(() => undefined).then(fn);
    queue = next;
    return next;
  };

  async function load(): Promise<Saved> {
    if (cache) return cache;
    try {
      const raw = await storage.getItem(APPROVALS_KEY);
      if (raw) cache = JSON.parse(raw) as Saved;
      else {
        const legacy = await storage.getItem(LEGACY_APPROVALS_KEY);
        const old = legacy ? (JSON.parse(legacy) as Record<string, string[]>) : {};
        // No identity on record: the project's is taken the next time it's checked.
        cache = Object.fromEntries(Object.entries(old).filter(([, keys]) => Array.isArray(keys) && keys.length).map(([p, keys]) => [p, { id: '', keys }]));
        if (legacy) {
          await save(cache);
          await Promise.resolve(storage.removeItem(LEGACY_APPROVALS_KEY)).catch(() => undefined);
        }
      }
    } catch {
      cache = {};
    }
    // Identities saved before they were known to be unreliable here (an
    // Android folder's last-modified time) would revoke approvals once the
    // folder changes: they're dropped.
    if (!trusted() && Object.values(cache!).some((e) => e?.id)) {
      await save(Object.fromEntries(Object.entries(cache!).map(([p, e]) => [p, { ...e, id: '' }])));
    }
    return cache!;
  }

  async function save(next: Saved) {
    cache = next;
    await Promise.resolve(storage.setItem(APPROVALS_KEY, JSON.stringify(next))).catch(() => undefined);
  }

  const without = (saved: Saved, project: string) => {
    const { [project]: _gone, ...rest } = saved;
    return rest;
  };

  return {
    isAllowed: (project: string, key: string) =>
      serial(async () => {
        const saved = await load();
        const entry = saved[project];
        if (!entry?.keys.includes(key)) return false;
        const id = await known(project);
        if (id === null) return false;
        if (!sameProject(entry.id, id)) {
          // Another project now has this name.
          await save(without(saved, project));
          return false;
        }
        if (!entry.id && id) await save({ ...saved, [project]: { ...entry, id } });
        return true;
      }),
    setAllowed: (project: string, key: string, allowed: boolean) =>
      serial(async () => {
        const saved = await load();
        const id = (await known(project)) ?? '';
        const prev = saved[project];
        const keys = new Set(prev && sameProject(prev.id, id) ? prev.keys : []);
        if (allowed) keys.add(key);
        else keys.delete(key);
        await save(keys.size ? { ...saved, [project]: { id: id || prev?.id || '', keys: [...keys] } } : without(saved, project));
      }),
    // How many approvals there are, across projects.
    count: () => serial(async () => Object.values(await load()).reduce((n, e) => n + e.keys.length, 0)),
    renameProject: (from: string, to: string) =>
      serial(async () => {
        const saved = await load();
        if (!saved[from] || from === to) return;
        await save({ ...without(saved, from), [to]: saved[from] });
      }),
    forget: (project: string) =>
      serial(async () => {
        const saved = await load();
        if (saved[project]) await save(without(saved, project));
      }),
    // Settings, AI assistant: Reset command approvals.
    clearAll: () => serial(() => save({})),
  };
}

export type Approvals = ReturnType<typeof createApprovals>;
