// Which project a saved record belongs to, beyond its name. Pending agent
// changes and "always allow" approvals are saved by project name; a project
// deleted in the Files app and made again (or another clone dropped in) under
// the same name must not inherit them.
//
// The identity is the project folder's creation time: a rename moves the
// folder and keeps it, a folder made again gets a new one.

// null: there's no such project folder. '': it exists, but its identity
// can't be read (then only the name is checked).
export type Identify = (project: string) => Promise<string | null>;

// Whether a record saved for `saved` belongs to the project identified now
// as `current`. Unknown on either side counts as the same.
export const sameProject = (saved: string | undefined, current: string) => !saved || !current || saved === current;

export const folderIdentity: Identify = async (project) => {
  try {
    // Loaded here, so modules that only take an Identify stay testable.
    const { Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const { PROJECTS_DIR } = require('../files/workspace') as typeof import('../files/workspace');
    const info = new Directory(Paths.document, `${PROJECTS_DIR}/${project}`).info();
    if (!info.exists) return null;
    return info.creationTime ? String(Math.round(info.creationTime)) : '';
  } catch {
    return '';
  }
};
