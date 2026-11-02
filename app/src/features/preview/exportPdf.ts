// Markdown (or a notebook) as a PDF, for sharing or printing. Printed in light
// colors whatever the app's theme; diagrams print as their source, since the
// page is printed without running scripts.
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { buffersStore } from '../../state';
import { bufferKey } from '../../state/buffers';
import { previewBody } from './PreviewPane';
import { previewPage } from './render';

const PRINT = { background: '#ffffff', foreground: '#1a1a1a', muted: '#666666', border: '#d0d0d0', code: '#f3f3f3', link: '#2a5bd7', error: '#c0392b' };

export async function exportPdf(project: string, path: string): Promise<void> {
  await buffersStore.getState().load(project, path);
  const content = buffersStore.getState().buffers[bufferKey(project, path)]?.content ?? '';
  const html = previewPage(await previewBody(project, path, content), PRINT, 12);
  // A4 at 72 points per inch, with room to staple.
  const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842, margins: { left: 40, right: 40, top: 48, bottom: 48 } });
  const name = `${(path.split('/').pop() ?? 'document').replace(/\.[^.]+$/, '')}.pdf`;
  const out = new File(Paths.cache, name);
  if (out.exists) out.delete();
  new File(uri).move(out);
  await Sharing.shareAsync(out.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: name });
}
