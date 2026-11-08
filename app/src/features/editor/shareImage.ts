import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// "Share selection as image": the PNG the editor drew (base64) goes to a
// cache file, then to the share sheet, like Share file and Export as PDF.
export async function shareCodeImage(name: string, base64: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  const out = new File(Paths.cache, name);
  if (out.exists) out.delete();
  out.create();
  await out.write(base64, { encoding: 'base64' });
  await Sharing.shareAsync(out.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: name });
}
