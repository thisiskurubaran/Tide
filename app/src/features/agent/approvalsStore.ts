// The app's command approvals, saved in app state (.tide). They follow
// project renames and deletes (registered in changesStore.ts, which loads at
// start-up).
import { storage } from '../../state';
import { createApprovals } from './approvals';
import { folderIdentity } from './projectIdentity';

export const commandApprovals = createApprovals(storage, folderIdentity);
