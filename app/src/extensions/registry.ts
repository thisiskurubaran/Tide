import { debuggerExtension } from './debugger';
import { formatLintExtension } from './formatLint';
import { gitProExtension } from './gitPro';
import { intellisenseExtension } from './intellisense';
import { themesExtension } from './themes';
import type { TideExtension } from './types';

// Every extension the app ships, in the order their commands and panels appear.
export const allExtensions: TideExtension[] = [themesExtension, formatLintExtension, gitProExtension, intellisenseExtension, debuggerExtension];
