import { Paths } from 'expo-file-system';
import nodejs from 'nodejs-mobile-react-native';

import { createNodeRunner } from './nodeRunner';

// RunRequest paths are relative to the Documents directory; the supervisor
// needs it as a plain filesystem path.
function documentsPath() {
  const uri = Paths.document.uri.replace(/^file:\/\//, '');
  return decodeURIComponent(uri).replace(/\/$/, '');
}

export const nodeRunner = createNodeRunner(nodejs, documentsPath);
