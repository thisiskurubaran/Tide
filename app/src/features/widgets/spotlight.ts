// Keeps Spotlight's index of projects in step with the project list: each
// change (create, rename, delete, a new language or last-opened time)
// re-indexes, and projects that are gone are removed. Changes that come close
// together go out once. Pure apart from the injected native calls.
import type { SpotlightProject } from '../../../modules/tide-widgets/src';

export interface SpotlightNative {
  index(projects: SpotlightProject[]): Promise<void>;
  remove(names: string[]): Promise<void>;
}

export const SPOTLIGHT_DELAY_MS = 1000;

export function createSpotlightSync(native: SpotlightNative, { delay = SPOTLIGHT_DELAY_MS }: { delay?: number } = {}) {
  let indexed: string[] = [];
  let lastKey = '';
  let latest: SpotlightProject[] | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const flush = () => {
    timer = undefined;
    if (stopped || !latest) return;
    const items = latest;
    latest = null;
    const key = JSON.stringify(items);
    if (key === lastKey) return;
    lastKey = key;
    const names = items.map((i) => i.name);
    const gone = indexed.filter((n) => !names.includes(n));
    indexed = names;
    if (gone.length) native.remove(gone).catch(() => undefined);
    native.index(items).catch(() => undefined);
  };

  return {
    update(items: SpotlightProject[]) {
      if (stopped) return;
      latest = items;
      if (!timer) timer = setTimeout(flush, delay);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
