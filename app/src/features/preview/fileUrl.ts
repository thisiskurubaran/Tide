// file:// URLs for a project's files, for previewing its HTML straight from
// disk (relative CSS, JS and images resolve on their own).
import { Directory, File, Paths } from 'expo-file-system';

import { PROJECTS_DIR } from '../files/workspace';

const withSlash = (uri: string) => (uri.endsWith('/') ? uri : `${uri}/`);

export const projectDirUrl = (project: string) => withSlash(new Directory(Paths.document, PROJECTS_DIR, project).uri);
export const projectFileUrl = (project: string, path: string) => new File(Paths.document, PROJECTS_DIR, project, ...path.split('/')).uri;
