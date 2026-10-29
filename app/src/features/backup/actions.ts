// The parts of backup that need native modules: the share sheet, the file
// picker and the cache directory.
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { workspace } from '../../state';
import { BackupError, zipEntries, zipProject } from './zip';

// Zips the project into the cache and opens the share sheet, from which it
// can go to Files, AirDrop, mail and so on.
export async function exportProject(project: string): Promise<void> {
  const { zip } = await zipProject(workspace, project);
  const out = new File(Paths.cache, `${project}.zip`);
  if (out.exists) out.delete();
  out.create();
  out.write(zip);
  if (!(await Sharing.isAvailableAsync())) throw new BackupError('Sharing is not available on this device');
  await Sharing.shareAsync(out.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: `Export ${project}` });
}

// Asks for a .zip and returns its files, or null if the picker was cancelled.
export async function pickZip(): Promise<{ name: string; entries: ReturnType<typeof zipEntries> } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { name: asset.name.replace(/\.zip$/i, ''), entries: await readZip(asset.uri) };
}

// The files in a .zip at `uri`, e.g. one picked or handed over by another app.
export async function readZip(uri: string): Promise<ReturnType<typeof zipEntries>> {
  const entries = zipEntries(await new File(uri).bytes());
  if (!entries.length) throw new BackupError('The zip has no files in it');
  return entries;
}
