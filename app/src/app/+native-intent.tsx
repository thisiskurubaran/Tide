import { incomingFile } from '../features/external/incoming';

// Files opened in Tide from other apps arrive as file:// or content:// URLs,
// which aren't routes; send them to the screen that imports them.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return incomingFile(path) ? `/open?uri=${encodeURIComponent(path)}` : path;
}
