import { appFs } from '../../state';
import { createDocs } from './docs';

export const docs = createDocs(appFs, (url) => fetch(url));
