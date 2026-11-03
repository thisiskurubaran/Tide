// The run Live Activity for dev servers, test runs and tasks. The project
// screen tells it when a run starts, what it prints and how it exits; it
// does nothing where there are no Live Activities (Android, web, turned off).
import { endRunActivity, startRunActivity, updateRunActivity } from '../../../modules/tide-widgets/src';
import { settingsStore } from '../../state';
import { createRunActivity } from './runOutput';

export type { RunActivityController, RunKind, RunStatus } from './runOutput';

export const runActivity = createRunActivity(
  { start: startRunActivity, update: updateRunActivity, end: endRunActivity },
  { enabled: () => settingsStore.getState().liveActivities !== false },
);
