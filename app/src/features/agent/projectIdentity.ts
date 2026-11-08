// Which project a saved record belongs to, beyond its name. Pending agent
// changes and "always allow" approvals are saved by project name; a project
// deleted in the Files app and made again (or another clone dropped in) under
// the same name must not inherit them.
//
// The identity is the project folder's creation (birth) time: a rename moves
// the folder and keeps it, a folder made again gets a new one. That only holds
// where the platform reports a real birth time:
//   iOS      APFS keeps one, and expo-file-system returns it.
//   Android  expo-file-system reads BasicFileAttributes.creationTime(), which
//            libcore can't get on Linux filesystems, so it's the folder's
//            last-modified time: it changes whenever an entry is added, removed
//            or renamed at the project root. Matching on it would drop pending
//            changes (applied ones included) and approvals on the next launch.
//            expo-file-system has no inode either, so on Android the identity
//            is unknown ('') and records are matched by name only; same-name
//            projects are then told apart by the delete and rename hooks, and a
//            record goes when its folder is gone (identify returns null).
// Identities saved on Android before this (stale mtimes) are ignored: see
// `identityReliable` and the stores' loading.
import { Platform } from 'react-native';

// null: there's no such project folder. '': it exists, but its identity
// can't be read (then only the name is checked).
export interface Identify {
  (project: string): Promise<string | null>;
  // Whether a known identity can be trusted to tell projects apart here.
  // Saved identities are ignored, and never cause a record to be dropped,
  // when this says no. Absent: trusted (an identity given directly, in tests).
  reliable?: () => boolean;
}

export const identityReliable = (identify: Identify | undefined) => !!identify && (identify.reliable ? identify.reliable() : true);

// Whether a record saved for `saved` belongs to the project identified now
// as `current`. Unknown on either side counts as the same.
export const sameProject = (saved: string | undefined, current: string) => !saved || !current || saved === current;

// Birth times are only real on iOS (see the top of this file).
const birthTimeIsReal = () => Platform.OS === 'ios';

export const folderIdentity: Identify = Object.assign(
  async (project: string): Promise<string | null> => {
    try {
      // Loaded here, so modules that only take an Identify stay testable.
      const { Directory, Paths } = require('expo-file-system') as typeof import('expo-file-system');
      const { PROJECTS_DIR } = require('../files/workspace') as typeof import('../files/workspace');
      const info = new Directory(Paths.document, `${PROJECTS_DIR}/${project}`).info();
      if (!info.exists) return null;
      if (!birthTimeIsReal()) return '';
      return info.creationTime ? String(Math.round(info.creationTime)) : '';
    } catch {
      return '';
    }
  },
  { reliable: birthTimeIsReal },
);
