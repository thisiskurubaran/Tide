// The app's Local shell history store (see shell/history.ts), following
// project renames and deletes.
import { appFs, onProjectChange } from '../../state';
import { createTerminalHistory } from './shell/history';

export const terminalHistory = createTerminalHistory(appFs);

onProjectChange({
  renamed: (from, to) => terminalHistory.renameProject(from, to),
  deleted: (project) => terminalHistory.removeProject(project),
});
