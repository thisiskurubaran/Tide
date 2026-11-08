import { onProjectChange, projectsStore, storage } from '../../state';
import { projectSecrets } from '../env/store';
import { createAutoDeployer, createDeployStore } from './auto';
import { deploy, deployHooks, readConfig } from './deploy';

export const deployStore = createDeployStore(storage);
export const autoDeployer = createAutoDeployer({ store: deployStore, readConfig, deploy });

// Keychain entries kept per project (secrets, the Render deploy hook) follow
// renames and go with deletes. Registered here because this loads at start-up.
// Each runs on its own: one failing doesn't leave the other behind.
const keychains = [projectSecrets, deployHooks];
const each = async (fn: (k: (typeof keychains)[number]) => Promise<void>) => {
  const results = await Promise.allSettled(keychains.map(fn));
  for (const r of results) if (r.status === 'rejected') console.warn('Could not update a Keychain entry for a project', r.reason);
};
onProjectChange({
  renamed: (from, to) => each((k) => k.rename(from, to)),
  deleted: (project) => each((k) => k.remove(project)),
});

// Once the projects have loaded, entries of projects whose folder is gone are
// removed (deleted in the Files app; a project made later under the name
// mustn't get them).
const reconcileKeychains = () => void each((k) => k.reconcile());
if (projectsStore.getState().loaded) reconcileKeychains();
else {
  const unsubscribe = projectsStore.subscribe((s) => {
    if (!s.loaded) return;
    unsubscribe();
    reconcileKeychains();
  });
}
