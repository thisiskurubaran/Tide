// Links into Tide, for the Shortcuts app, home screen quick actions, notes
// and anything else that can open a URL:
//
//   tide://project/<name>                       open a project
//   tide://project/<name>?file=src/a.ts&line=12 ...at a file and line
//   tide://project/<name>?run=1                 ...and run it
//   tide://project/<name>?tests=1               ...and run its tests (opens the Tests sheet)
//   tide://project/<name>?stop=1                ...and stop what's running (the run Live Activity's Stop)
//   tide://project/<name>?file=api.http&send=1  ...and send a .http file's first
//                                               request (or send=<name> for one by name)
//   tide://?new=1                               start a new project
export const SCHEME = 'tide';

export interface ProjectLinkOptions {
  file?: string;
  line?: number;
  run?: boolean;
  // Open the Tests sheet and run the tests.
  tests?: boolean;
  // Stop the project's running dev server, tests or task.
  stop?: boolean;
  // A request in the .http `file` to send: its name, or "1" for the first.
  send?: string;
}

export function projectPath(project: string, { file, line, run, tests, stop, send }: ProjectLinkOptions = {}): string {
  const query = new URLSearchParams();
  if (file) query.set('file', file);
  if (file && line) query.set('line', String(line));
  if (run) query.set('run', '1');
  if (tests) query.set('tests', '1');
  if (stop) query.set('stop', '1');
  if (file && send) query.set('send', send);
  const q = query.toString();
  return `/project/${encodeURIComponent(project)}${q ? `?${q}` : ''}`;
}

export const projectLink = (project: string, options?: ProjectLinkOptions) => `${SCHEME}:/${projectPath(project, options)}`;

const flag = (v?: string) => v === '1' || v === 'true';

// What a project route was asked to do on opening, from its search params.
export function launchParams(params: { file?: string; line?: string; run?: string; tests?: string; stop?: string; send?: string }): ProjectLinkOptions | null {
  const line = Number(params.line);
  const out: ProjectLinkOptions = {
    file: params.file || undefined,
    line: Number.isInteger(line) && line > 0 ? line : undefined,
    run: flag(params.run),
    send: params.file && params.send ? params.send : undefined,
  };
  // Only present when asked for, so existing links read as before.
  if (flag(params.tests)) out.tests = true;
  if (flag(params.stop)) out.stop = true;
  return out.file || out.run || out.tests || out.stop ? out : null;
}

// Any app or web page can open these links, so one that runs code, sends a
// request or deploys asks first, naming the project and what it will do.
// (Tide's own Shortcuts actions and widgets open the same links; they ask too,
// as there is no way here to tell them apart from anyone else's.)
export interface LinkConfirmation {
  title: string;
  message: string;
  // The button that goes ahead.
  action: string;
}

const quoted = (s: string) => `“${s}”`;

// What a project link would do that needs a yes first, or null for links that
// only open things (or stop what's running).
export function launchConfirmation(project: string, launch: ProjectLinkOptions | null): LinkConfirmation | null {
  if (!launch) return null;
  const actions: string[] = [];
  if (launch.file && launch.send) actions.push(`send ${launch.send === '1' ? 'the first request' : `the request ${quoted(launch.send)}`} in ${quoted(launch.file)}`);
  if (launch.tests) actions.push('run its tests');
  if (launch.run) actions.push('run it');
  if (!actions.length) return null;
  const what = actions.length > 1 ? `${actions.slice(0, -1).join(', ')} and ${actions[actions.length - 1]}` : actions[0];
  return {
    title: launch.run ? `Run ${quoted(project)}?` : launch.tests ? `Run tests in ${quoted(project)}?` : 'Send request?',
    message: `A link asked Tide to open ${quoted(project)} and ${what}. Only continue if you started this.`,
    action: launch.run || launch.tests ? 'Run' : 'Send',
  };
}

// tide://deploy?project=X&go=1
export function deployConfirmation(project: string): LinkConfirmation {
  return {
    title: `Deploy ${quoted(project)}?`,
    message: `A link asked Tide to deploy ${quoted(project)} now. Only continue if you started this.`,
    action: 'Deploy',
  };
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
