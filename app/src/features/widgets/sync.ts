// What the widget extension and the Shortcuts actions are told, and when a
// deploy's Live Activity starts, changes or ends. Pure, so it's testable
// without the native module.
import type { DeployStatus } from '../deploy/auto';

export function sharedData(pro: boolean, projects: string[], recent: string[]): string {
  return JSON.stringify({ pro, projects, recent: recent.filter((p) => projects.includes(p)).slice(0, 8) });
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
