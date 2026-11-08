// What the widget extension and the Shortcuts actions are told, and when a
// deploy's Live Activity starts, changes or ends. Pure, so it's testable
// without the native module.
import type { RunKind, RunStatus } from '../../../modules/tide-widgets/src';
import type { DeployStatus } from '../deploy/auto';

// A project's main language, as the home screen's card shows it.
export interface ProjectLanguage {
  // "TypeScript"-style name, e.g. "TS", "Python".
  name: string;
  // The file badge's short label ("TS", "Py", "<>") and color ("#6f9dff").
  badge: string;
  color: string;
}

export interface ProjectGit {
  branch: string | null;
  changes: number;
}

// The last dev server, test run or task to finish, for the Last run widget.
export interface LastRun {
  project: string;
  command: string;
  kind: RunKind;
  status: Exclude<RunStatus, 'running'>;
  detail: string;
  exitCode: number | null;
  // ms since the epoch
  startedAt: number;
  endedAt: number;
}

export interface WidgetInputs {
  projects: string[];
  // Most recently opened first (tabs store).
  recent: string[];
  // When each project was last opened, ms since the epoch (recents store).
  openedAt?: Record<string, number>;
  languages?: Record<string, ProjectLanguage | null | undefined>;
  git?: Record<string, ProjectGit | null | undefined>;
  files?: { project: string; path: string; at: number }[];
  lastRun?: LastRun | null;
}

// One project as a widget row shows it. Optional fields are left out when
// unknown, so the widget shows nothing rather than a guess.
export interface WidgetProject {
  name: string;
  language?: string;
  badge?: string;
  color?: string;
  branch?: string;
  changes?: number;
  openedAt?: number;
}

export interface WidgetData {
  // Every project, and the recent ones still there: the Shortcuts actions and
  // controls read these two (and older widget builds only these).
  projects: string[];
  recent: string[];
  // The rows the widgets show: the recent projects, or the first projects
  // when nothing was opened yet.
  cards: WidgetProject[];
  files: { project: string; path: string; at: number }[];
  lastRun: LastRun | null;
}

export const MAX_CARDS = 6;
export const MAX_FILES = 6;

export function widgetData({ projects, recent, openedAt = {}, languages = {}, git = {}, files = [], lastRun = null }: WidgetInputs): WidgetData {
  const exists = new Set(projects);
  const recentHere = recent.filter((p) => exists.has(p)).slice(0, 8);
  // Opened before but not in the tab store's short list: by last opened.
  const byOpened = projects.filter((p) => openedAt[p] != null && !recentHere.includes(p)).sort((a, b) => openedAt[b] - openedAt[a]);
  const rest = projects.filter((p) => !recentHere.includes(p) && !byOpened.includes(p));
  const names = [...recentHere, ...byOpened, ...rest].slice(0, MAX_CARDS);
  const cards = names.map((name) => {
    const card: WidgetProject = { name };
    const lang = languages[name];
    if (lang) Object.assign(card, { language: lang.name, badge: lang.badge, color: lang.color });
    const g = git[name];
    if (g) {
      if (g.branch) card.branch = g.branch;
      card.changes = g.changes;
    }
    if (openedAt[name] != null) card.openedAt = openedAt[name];
    return card;
  });
  return {
    projects,
    recent: recentHere,
    cards,
    files: files.filter((f) => exists.has(f.project)).slice(0, MAX_FILES),
    lastRun: lastRun && exists.has(lastRun.project) ? lastRun : null,
  };
}

export function sharedData(projects: string[], recent: string[], extra: Omit<WidgetInputs, 'projects' | 'recent'> = {}): string {
  return JSON.stringify(widgetData({ projects, recent, ...extra }));
}

// The language of a project from its badge (FileBadge) and name
// (summarizeLanguages), or null when it has none worth showing.
export function projectLanguage(summary: { badge: { text: string; color: string } | null; languages: string[] } | null | undefined): ProjectLanguage | null {
  if (!summary?.badge || !summary.languages[0]) return null;
  return { name: summary.languages[0], badge: summary.badge.text, color: summary.badge.color };
}

// What Spotlight indexes for each project.
export function spotlightItems(projects: string[], languages: Record<string, ProjectLanguage | null | undefined>, openedAt: Record<string, number>) {
  return projects.map((name) => {
    const item: { name: string; language?: string; openedAt?: number } = { name };
    const lang = languages[name];
    if (lang) item.language = lang.name;
    if (openedAt[name] != null) item.openedAt = openedAt[name];
    return item;
  });
}

export type ActivityStep =
  | { kind: 'start'; project: string; provider: string; message: string }
  | { kind: 'update'; project: string; state: DeployStatus['state']; message: string; url: string | null };

// Steps to take for statuses that changed: start an activity when a deploy
// starts, and update (or with a result, end) one that's running.
export function activitySteps(prev: Record<string, DeployStatus | undefined>, next: Record<string, DeployStatus | undefined>, live: ReadonlySet<string>): ActivityStep[] {
  const steps: ActivityStep[] = [];
  for (const [project, status] of Object.entries(next)) {
    const before = prev[project];
    if (!status || status === before) continue;
    if (status.state === 'deploying' && !live.has(project) && before?.state !== 'deploying') {
      steps.push({ kind: 'start', project, provider: status.provider ?? '', message: status.message });
    } else if (live.has(project)) {
      steps.push({ kind: 'update', project, state: status.state, message: status.message, url: status.url ?? null });
    }
  }
  return steps;
}
