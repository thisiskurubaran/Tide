// Tide on the Home Screen and Lock Screen: keeps the widget's recent
// projects current, and shows deploys as a Live Activity.
import TideWidgets from '../../../modules/tide-widgets/src';
import { projectsStore, settingsStore, tabsStore } from '../../state';
import { deployStore } from '../deploy';
import { PROVIDERS } from '../deploy/deploy';
import { activitySteps, sharedData } from './sync';

export function startWidgets(): () => void {
  const native = TideWidgets;
  if (!native) return () => undefined;

  let last = '';
  const sync = () => {
    const json = sharedData(projectsStore.getState().projects, tabsStore.getState().recent);
    if (json === last) return;
    last = json;
    native.setSharedData(json);
  };
  sync();

  // project -> activity id, or the pending start.
  const live = new Map<string, Promise<string | null>>();
  const offDeploys = deployStore.subscribe((next, prev) => {
    for (const step of activitySteps(prev.status, next.status, new Set(live.keys()))) {
      if (step.kind === 'start') {
        if (settingsStore.getState().liveActivities === false) continue;
        const label = PROVIDERS.find((p) => p.id === step.provider)?.label ?? step.provider;
        live.set(step.project, native.startDeployActivity(step.project, label, step.message).catch(() => null));
      } else {
        const id = live.get(step.project)!;
        if (step.state !== 'deploying') live.delete(step.project);
        id.then((i) => (i ? native.updateDeployActivity(i, step.state, step.message, step.url) : undefined)).catch(() => undefined);
      }
    }
  });

  const unsubs = [projectsStore.subscribe(sync), tabsStore.subscribe(sync), offDeploys];
  return () => unsubs.forEach((u) => u());
}
