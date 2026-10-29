import type { TideExtension } from '../types';
import { GitProPanel } from './GitProPanel';

export const GIT_PRO_PANEL = 'git-pro';

// Git Pro replaces the Source Control sheet (see ProjectScreen) and switches on
// the editor's merge conflict actions.
export const gitProExtension: TideExtension = {
  id: 'git-pro',
  editor: { conflicts: true },
  panels: [{ id: GIT_PRO_PANEL, component: GitProPanel }],
  commands: (ctx) => [
    { id: 'git-pro.branches', title: 'Git: branches', icon: 'git-branch', run: () => ctx.openPanel(GIT_PRO_PANEL) },
    { id: 'git-pro.history', title: 'Git: history', icon: 'clock', run: () => ctx.openPanel(GIT_PRO_PANEL) },
  ],
};
