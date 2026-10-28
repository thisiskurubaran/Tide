import nodejs from 'nodejs-mobile-react-native';

import { documentsPath } from '../paths';
import { createNodeRunner } from './nodeRunner';

export const nodeRunner = createNodeRunner(nodejs, documentsPath);
