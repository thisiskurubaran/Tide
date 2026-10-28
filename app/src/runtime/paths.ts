import { Paths } from 'expo-file-system';

// RunRequest paths are relative to the Documents directory; runners need it
// as a plain filesystem path.
export function documentsPath() {
  const uri = Paths.document.uri.replace(/^file:\/\//, '');
  return decodeURIComponent(uri).replace(/\/$/, '');
}
