import { localRunner } from '../../runtime';
import { projectsStore } from '../../state';
import { trackGit } from '../widgets/liveActivities';
import { gitEnv } from './settings';
import { lastLines, runGit } from './runGit';

// Clones a repository into a new project and returns the project's name.
// Progress shows as a Live Activity.
export function cloneRepo(name: string, url: string): Promise<string> {
  return projectsStore.getState().cloneProject(name, async (p) => {
    const r = await trackGit(p, 'clone', (onOutput) => runGit(localRunner, p, ['clone', url, '.'], gitEnv(), onOutput), url);
    if (r.code !== 0) throw new Error(lastLines(r.stderr || r.stdout).replace(/^fatal: /, '') || 'Clone failed');
  });
}
