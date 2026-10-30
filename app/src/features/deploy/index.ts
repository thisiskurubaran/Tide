import { storage } from '../../state';
import { createAutoDeployer, createDeployStore } from './auto';
import { deploy, readConfig } from './deploy';

export const deployStore = createDeployStore(storage);
export const autoDeployer = createAutoDeployer({ store: deployStore, readConfig, deploy });
