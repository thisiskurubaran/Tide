import { localRunner } from '../../runtime';
import { projectsStore } from '../../state';
import { lastLines, runGit } from './runGit';

// Clones a repository into a new project and returns the project's name.
export function cloneRepo(name: string, url: string): Promise<string> {
  return projectsStore.getState().cloneProject(name, async (p) => {
    const r = await runGit(localRunner, p, ['clone', url, '.']);
    if (r.code !== 0) throw new Error(lastLines(r.stderr || r.stdout).replace(/^fatal: /, '') || 'Clone failed');
  });
}
