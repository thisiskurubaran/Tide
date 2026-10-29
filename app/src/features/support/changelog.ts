// Shown once after an update (What's new), and from Settings at any time.
// Newest first; add an entry with each release.
export interface Release {
  version: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '2.0.0',
    items: [
      'GitHub: sign in, browse and clone your repositories, review and merge pull requests, work on issues and follow Actions',
      'Deploy a website to GitHub Pages, Netlify, Vercel or Cloudflare Pages, or start a Render deploy',
      'SSH: a terminal on your own servers and SFTP to browse and edit their files, with ed25519 keys kept in the Keychain',
      'Send HTTP requests from .http files and read formatted responses',
      'Browse and query SQLite databases, and see JSON as a collapsible tree',
      'Vim and Emacs key bindings for the editor, in Settings',
    ],
  },
  {
    version: '1.0.1',
    items: [
      'cd works with folder names that have spaces, and Tab completion escapes them',
      'The new project sheet scrolls when the keyboard is open and stays below the status bar',
      'Tour buttons fit on every iPhone, including with larger text sizes',
      'Buttons grow with larger text sizes instead of cutting off their labels',
    ],
  },
  {
    version: '1.0.0',
    items: [
      'Open folders from Files and iCloud Drive, and sync changes back',
      'Open files from other apps in Tide, and share files out',
      'Several terminals at once, and a split editor on iPad',
      'Search and replace across the project, with regular expressions',
      'Code folding, indent guides, minimap and word wrap settings',
      'A key bar you can arrange per language, a cursor trackpad and pinch to zoom',
      'Full hardware keyboard shortcuts; press ⇧⌘? to see them all',
      'Preview web servers you start on the device',
      'Export projects as .zip, import them back, and automatic snapshots',
      'tide:// links for Shortcuts, and quick actions on the app icon',
      'Haptics, faster big projects, and Help & feedback in Settings',
    ],
  },
];

// The releases newer than `seen`, or none on a first launch (seen is null).
export function unseenReleases(seen: string | null, current: string, changelog = CHANGELOG): Release[] {
  if (seen === null || seen === current) return [];
  const newer = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
    }
    return false;
  };
  return changelog.filter((r) => newer(r.version, seen) && !newer(r.version, current));
}
