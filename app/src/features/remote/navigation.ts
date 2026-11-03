// Where the browser preview may go. It shows the server the project runs:
// pages on that host stay in the preview, while links to other websites open
// in Safari. Tide is not a web browser (its App Store age rating says there
// is no unrestricted web access), so the preview never wanders off the web.
export type PreviewNavigation = 'allow' | 'external' | 'block';

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    // localhost and 127.0.0.1 are the same server on the device.
    return u.hostname === 'localhost' ? '127.0.0.1' : u.hostname;
  } catch {
    return null;
  }
};

// A project's own HTML file opened straight from disk: other files in the
// project folder (links between pages) stay in the preview.
const projectRoot = (url: string) => /^(file:\/\/.*?\/projects\/[^/]+\/)/.exec(url)?.[1] ?? null;

export function previewNavigation(target: string, start: string, isTopFrame = true): PreviewNavigation {
  // Frames inside the page (embeds) and the page's own internal documents load as part of it.
  if (!isTopFrame || /^(about:blank|data:|blob:)/i.test(target)) return 'allow';
  if (/^file:/i.test(target)) {
    const root = projectRoot(start);
    return root !== null && target.startsWith(root) && !target.slice(root.length).split(/[?#]/)[0].split('/').includes('..') ? 'allow' : 'block';
  }
  if (!/^https?:/i.test(target)) return /^(mailto|tel):/i.test(target) ? 'external' : 'block';
  // Another port on the same host is still the project (a second dev server, the remote preview proxy).
  return hostOf(target) !== null && hostOf(target) === hostOf(start) ? 'allow' : 'external';
}
