import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { buffersStore, projectsStore, workspace } from '../../state';
import { PROJECTS_DIR } from '../files/workspace';
import { readZip } from '../backup/actions';
import { toBase64, writeEntries } from '../backup/zip';
import { freeName, Incoming } from './incoming';

// Opens the share sheet for one file of a project: AirDrop, Messages, Mail,
// "Save to Files" and other apps.
export async function shareFile(project: string, path: string): Promise<void> {
  await buffersStore.getState().save(project, path);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(new File(Paths.document, `${PROJECTS_DIR}/${project}/${path}`).uri, { dialogTitle: path.split('/').pop() });
}

// A file handed over by another app, copied into the root of `project`.
// Returns the path it was saved as.
export async function addToProject(incoming: Incoming, project: string): Promise<string> {
  const bytes = await new File(incoming.uri).bytes();
  const names = new Set((await workspace.list(project, '')).map((e) => e.name));
  const path = freeName(incoming.name, (n) => names.has(n));
  await workspace.writeBase64(project, path, toBase64(bytes));
  await projectsStore.getState().loadTree(project);
  return path;
}

// A .zip handed over by another app becomes a new project.
export async function importZip(incoming: Incoming, name: string): Promise<string> {
  const entries = await readZip(incoming.uri);
  return projectsStore.getState().cloneProject(name || incoming.name.replace(/\.zip$/i, ''), (p) => writeEntries(workspace, p, entries));
}

// iOS copies opened files into Documents/Inbox; they are ours to delete.
export function discardIncoming(incoming: Incoming): void {
  try {
    if (incoming.uri.includes('/Documents/Inbox/')) new File(incoming.uri).delete();
  } catch {
    // Already gone.
  }
}
