import { openDatabaseAsync } from 'expo-sqlite';

import { documentsPath } from '../../runtime/paths';
import { PROJECTS_DIR } from '../files/workspace';
import type { Db } from './database';

// A database file in a project, on a connection of its own so programs run in
// the terminal keep theirs. A missing file is created, as sqlite3 does.
export function openProjectDb(project: string, path: string): Promise<Db> {
  const slash = path.lastIndexOf('/');
  const dir = `${documentsPath()}/${PROJECTS_DIR}/${project}${slash > 0 ? `/${path.slice(0, slash)}` : ''}`;
  return openDatabaseAsync(path.slice(slash + 1), { useNewConnection: true }, dir);
}
