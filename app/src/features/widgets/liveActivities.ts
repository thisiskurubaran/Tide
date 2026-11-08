// The git, package install and AI agent Live Activities as the app runs them:
// the controllers in activities.ts wired to the native module and the Live
// Activities setting. Light to import, so git, packages and the agent can
// call in without loading anything else.
import {
  endAgentActivity,
  endGitActivity,
  endInstallActivity,
  startAgentActivity,
  startGitActivity,
  startInstallActivity,
  updateAgentActivity,
  updateGitActivity,
  updateInstallActivity,
} from '../../../modules/tide-widgets/src';
import type { GitOperation } from '../../../modules/tide-widgets/src';
import { settingsStore } from '../../state';
import { AgentSnapshot, createAgentActivity, createGitActivity, createInstallActivity, withGitActivity } from './activities';

const enabled = () => {
  try {
    return settingsStore.getState().liveActivities !== false;
  } catch {
    return false;
  }
};

export const gitActivity = createGitActivity({ start: startGitActivity, update: updateGitActivity, end: endGitActivity }, { enabled });
export const installActivity = createInstallActivity({ start: startInstallActivity, update: updateInstallActivity, end: endInstallActivity }, { enabled });
export const agentActivity = createAgentActivity({ start: startAgentActivity, update: updateAgentActivity, end: endAgentActivity }, { enabled });

// Runs a git clone, pull or push with its Live Activity: `work` gets an
// output callback for progress, and the activity ends however `work` ends.
export const trackGit = <T>(project: string, operation: GitOperation, work: (onOutput: (text: string) => void) => Promise<T>, remote?: string) =>
  withGitActivity(gitActivity, { project, operation, remote }, work);

// Follows the agent's sessions store (agent/session.ts) for the agent's Live
// Activity. Returns a function that stops following.
export function watchAgentSessions(store: {
  getState(): { sessions: Record<string, AgentSnapshot> };
  subscribe(listener: (next: { sessions: Record<string, AgentSnapshot> }, prev: { sessions: Record<string, AgentSnapshot> }) => void): () => void;
}): () => void {
  return store.subscribe((next, prev) => {
    for (const [project, session] of Object.entries(next.sessions)) {
      if (session !== prev.sessions[project]) agentActivity.onSession(project, session);
    }
  });
}
