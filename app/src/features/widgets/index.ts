// Tide on the Home Screen, Lock Screen and in Spotlight: keeps the widgets'
// data current (recent projects with their language, branch and changes,
// recent files, the last run), shows deploys as a Live Activity, ends Live
// Activities a killed launch left behind, and indexes projects for Spotlight.
import { Linking } from 'react-native';

import TideWidgets, { endStaleActivities, indexProjects, removeIndexedProjects, takePendingLink } from '../../../modules/tide-widgets/src';
import { projectsStore, recentsStore, settingsStore, tabsStore, workspace } from '../../state';
import { deployStore } from '../deploy';
import { PROVIDERS } from '../deploy/deploy';
import { gitStatusStore } from '../git/status';
import { summarizeLanguages } from '../projects/summary';
import { lastRunStore } from './runActivity';
import { activitySteps, ProjectGit, ProjectLanguage, projectLanguage, sharedData, spotlightItems } from './sync';
import { createSpotlightSync } from './spotlight';

// Language summaries walk a project's files, so they wait until start-up is
// done, and run one project at a time.
const LANGUAGE_DELAY_MS = 2500;

export function startWidgets(): () => void {
  const native = TideWidgets;
  if (!native) return () => undefined;

  // Anything still on the Lock Screen is from a launch that was killed.
  endStaleActivities();

  // A Spotlight result that launched the app arrives before JS listens for links.
  const pending = takePendingLink();
  if (pending) Linking.openURL(pending).catch(() => undefined);

  const languages: Record<string, ProjectLanguage | null> = {};

  let last = '';
  const sync = () => {
    const git: Record<string, ProjectGit | null> = {};
    for (const [p, s] of Object.entries(gitStatusStore.getState().byProject)) git[p] = s ? { branch: s.branch, changes: Object.keys(s.changes).length } : null;
    const json = sharedData(projectsStore.getState().projects, tabsStore.getState().recent, {
      openedAt: recentsStore.getState().projects,
      languages,
      git,
      files: recentsStore.getState().files,
      lastRun: lastRunStore.getState().lastRun,
    });
    if (json === last) return;
    last = json;
    native.setSharedData(json);
  };
  sync();

  const spotlight = createSpotlightSync({ index: indexProjects, remove: removeIndexedProjects });
  const reindex = () => spotlight.update(spotlightItems(projectsStore.getState().projects, languages, recentsStore.getState().projects));
  reindex();

  // Languages for every project, one at a time; a new project's after it appears.
  let stopped = false;
  let queue: Promise<void> = new Promise((r) => setTimeout(r, LANGUAGE_DELAY_MS));
  const summarize = (projects: string[]) => {
    for (const p of projects) {
      if (p in languages) continue;
      languages[p] = null;
      queue = queue
        .then(async () => {
          if (stopped || !projectsStore.getState().projects.includes(p)) return;
          languages[p] = projectLanguage(summarizeLanguages(await workspace.listFiles(p)));
          sync();
          reindex();
        })
        .catch(() => undefined);
    }
  };
  summarize(projectsStore.getState().projects);

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

  const onProjects = (next: { projects: string[] }, prev: { projects: string[] }) => {
    sync();
    if (next.projects === prev.projects) return;
    summarize(next.projects);
    reindex();
  };

  const unsubs = [
    projectsStore.subscribe(onProjects),
    tabsStore.subscribe(sync),
    recentsStore.subscribe((next, prev) => {
      sync();
      if (next.projects !== prev.projects) reindex();
    }),
    gitStatusStore.subscribe(sync),
    lastRunStore.subscribe(sync),
    offDeploys,
  ];
  return () => {
    stopped = true;
    spotlight.stop();
    unsubs.forEach((u) => u());
  };
}
