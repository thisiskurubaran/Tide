import { storage } from '../../state';
import { createHistoryStore } from './history';

export const httpHistory = createHistoryStore(storage);
