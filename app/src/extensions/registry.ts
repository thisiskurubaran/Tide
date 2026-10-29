import { formatLintExtension } from './formatLint';
import { themesExtension } from './themes';
import type { TideExtension } from './types';

// Every extension the app ships, in the order their commands and panels appear.
export const allExtensions: TideExtension[] = [themesExtension, formatLintExtension];
