import { onProjectChange, storage } from '../../state';
import { projectSecrets } from '../env/store';
import { createAutoDeployer, createDeployStore } from './auto';
import { deploy, deployHooks, readConfig } from './deploy';

export const deployStore = createDeployStore(storage);
export const autoDeployer = createAutoDeployer({ store: deployStore, readConfig, deploy });

// Keychain entries kept per project (secrets, the Render deploy hook) follow
// renames and go with deletes. Registered here because this loads at start-up.
onProjectChange({
  renamed: async (from, to) => {
    await projectSecrets.rename(from, to);
    await deployHooks.rename(from, to);
  },
  deleted: async (project) => {
    await projectSecrets.remove(project);
    await deployHooks.remove(project);
  },
});
