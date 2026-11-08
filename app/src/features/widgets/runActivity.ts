// The run Live Activity for dev servers, test runs and tasks. The project
// screen tells it when a run starts, what it prints and how it exits; it
// does nothing where there are no Live Activities (Android, web, turned off).
// Every run's result is also kept for the Last run widget.
import { endRunActivity, startRunActivity, updateRunActivity } from '../../../modules/tide-widgets/src';
import { onProjectChange, settingsStore, storage } from '../../state';
import { createLastRunStore } from './lastRun';
import { createRunActivity } from './runOutput';

export type { RunActivityController, RunKind, RunStatus } from './runOutput';

export const lastRunStore = createLastRunStore(storage);
onProjectChange({
  renamed: async (from, to) => lastRunStore.getState().renameProject(from, to),
  deleted: async (project) => lastRunStore.getState().forget(project),
});

export const runActivity = createRunActivity(
  { start: startRunActivity, update: updateRunActivity, end: endRunActivity },
  {
    enabled: () => settingsStore.getState().liveActivities !== false,
    onResult: (r) => lastRunStore.getState().record(r),
  },
);
