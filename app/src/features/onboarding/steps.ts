import type { IconName } from '../../components/Button';

export interface Step {
  icon: IconName;
  title: string;
  body: string;
  // Short "how to" lines, shown as chips under the text.
  tips: string[];
}

// The first-run tour. Each step is one screen; keep them short.
export const STEPS: Step[] = [
  {
    icon: 'code',
    title: 'Welcome to Tide',
    body: 'A code editor with a terminal that runs JavaScript and Python on this device, offline.',
    tips: ['Node and Python built in', 'Works without a network'],
  },
  {
    icon: 'folder',
    title: 'Projects',
    body: 'Start from a template, clone from Git, import a .zip, or open a folder from Files or iCloud Drive and sync changes back.',
    tips: ['Long-press a project for more', 'Snapshots keep earlier copies'],
  },
  {
    icon: 'edit-3',
    title: 'Editing on a touch screen',
    body: 'The key bar above the keyboard has brackets, tab and arrows. Drag the trackpad key to move the cursor; pinch to change the text size.',
    tips: ['Settings > Key bar to arrange keys', 'Hold ⌘ on a keyboard for shortcuts'],
  },
  {
    icon: 'command',
    title: 'Everything is in the palette',
    body: 'Open files, search the project, run tasks, compare changes and more from the command palette.',
    tips: ['⌘P open a file', '⇧⌘P all commands'],
  },
  {
    icon: 'terminal',
    title: 'Run your code',
    body: 'Press Run (⌘R) or type in the terminal. Local mode runs on the device; Remote mode connects to a server for anything else.',
    tips: ['npm and pip install pure packages', 'Servers open in a preview'],
  },
  {
    icon: 'package',
    title: 'Make it yours',
    body: 'Extensions add themes, formatting and linting, Git Tools, IntelliSense and a debugger.',
    tips: ['Settings > Extensions'],
  },
];
