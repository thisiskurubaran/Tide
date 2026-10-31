// Links into Tide, for the Shortcuts app, home screen quick actions, notes
// and anything else that can open a URL:
//
//   tide://project/<name>                       open a project
//   tide://project/<name>?file=src/a.ts&line=12 ...at a file and line
//   tide://project/<name>?run=1                 ...and run it
//   tide://project/<name>?file=api.http&send=1  ...and send a .http file's first
//                                               request (or send=<name> for one by name)
//   tide://?new=1                               start a new project
export const SCHEME = 'tide';

export interface ProjectLinkOptions {
  file?: string;
  line?: number;
  run?: boolean;
  // A request in the .http `file` to send: its name, or "1" for the first.
  send?: string;
}

export function projectPath(project: string, { file, line, run, send }: ProjectLinkOptions = {}): string {
  const query = new URLSearchParams();
  if (file) query.set('file', file);
  if (file && line) query.set('line', String(line));
  if (run) query.set('run', '1');
  if (file && send) query.set('send', send);
  const q = query.toString();
  return `/project/${encodeURIComponent(project)}${q ? `?${q}` : ''}`;
}

export const projectLink = (project: string, options?: ProjectLinkOptions) => `${SCHEME}:/${projectPath(project, options)}`;

// What a project route was asked to do on opening, from its search params.
export function launchParams(params: { file?: string; line?: string; run?: string; send?: string }): ProjectLinkOptions | null {
  const line = Number(params.line);
  const out: ProjectLinkOptions = {
    file: params.file || undefined,
    line: Number.isInteger(line) && line > 0 ? line : undefined,
    run: params.run === '1' || params.run === 'true',
    send: params.file && params.send ? params.send : undefined,
  };
  return out.file || out.run ? out : null;
}

export interface QuickAction {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  params: { href: string };
}

// The home screen menu: new project, then the recent projects.
export function quickActions(recent: string[], projects: string[], max = 4): QuickAction[] {
  const open = recent.filter((p) => projects.includes(p)).slice(0, max - 1);
  return [
    { id: 'new', title: 'New project', icon: 'symbol:plus', params: { href: '/?new=1' } },
    ...open.map((p) => ({ id: `project:${p}`, title: p, subtitle: 'Open project', icon: 'symbol:folder', params: { href: projectPath(p) } })),
  ];
}
