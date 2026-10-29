// Files other apps hand to Tide: "Open in Tide" from the share sheet or
// Files on iOS, and "Open with" on Android. They arrive as a file:// or
// content:// URL, which the router sends to the /open screen.

export interface Incoming {
  uri: string;
  name: string;
  kind: 'zip' | 'file';
}

export function incomingFile(url: string): Incoming | null {
  if (!/^(file|content):\/\//i.test(url)) return null;
  const last = url.split(/[?#]/)[0].split('/').pop() ?? '';
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // Keep the raw name.
  }
  // content:// URIs often end in an id ("document/1234" or "primary:Download/a.py").
  name = name.split(':').pop()!.split('/').pop()!.trim() || 'shared-file';
  return { uri: url, name, kind: /\.zip$/i.test(name) ? 'zip' : 'file' };
}

// "notes.txt" -> "notes (2).txt" while the name is taken.
export function freeName(name: string, taken: (name: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf('.');
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const next = `${base} (${n})${ext}`;
    if (!taken(next)) return next;
  }
}
