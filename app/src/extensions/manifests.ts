// The paid extensions sold in the Extensions screen. Each one is a separate
// non-consumable in-app purchase; the code ships inside the app and a purchase
// only unlocks it, so nothing executable is ever downloaded (App Store 2.5.2).
// Plain data, no React Native imports, so tests and the web bundles can read it.
export type ExtensionId = 'themes' | 'format-lint' | 'git-pro' | 'intellisense' | 'debugger';

export interface ExtensionManifest {
  id: ExtensionId;
  name: string;
  tagline: string;
  // Feather icon name.
  icon: string;
  // Store product id, the same on the App Store and Google Play.
  productId: string;
  // Shown until the store returns the localized price, e.g. in development builds.
  fallbackPrice: string;
  features: string[];
  // Anything the extension can't do everywhere, shown on its card.
  note?: string;
}

const PRODUCT_PREFIX = 'com.thisiskurubaran.tide.ext';

export const manifests: ExtensionManifest[] = [
  {
    id: 'themes',
    name: 'Themes & Icons Pack',
    tagline: 'Popular editor and terminal themes, and colored file icons.',
    icon: 'droplet',
    productId: `${PRODUCT_PREFIX}.themes`,
    fallbackPrice: '$2.99',
    features: [
      'Dracula, One Dark, Monokai, Nord, Solarized Dark, Solarized Light and GitHub Light',
      'Each theme colors the editor and the terminal',
      'File icons by type in the file tree and tabs',
    ],
  },
  {
    id: 'format-lint',
    name: 'Format & Lint',
    tagline: 'Prettier, ESLint, autopep8 and pyflakes, with a Problems panel.',
    icon: 'check-circle',
    productId: `${PRODUCT_PREFIX}.format_lint`,
    fallbackPrice: '$4.99',
    features: [
      'Format document with Prettier: JS, TS, JSX, JSON, CSS, SCSS, HTML, Markdown and YAML',
      'Format Python with autopep8',
      'Format on save, if you turn it on',
      'ESLint warnings for JavaScript and pyflakes warnings for Python, inline as you type',
      'Problems panel listing every warning in open files',
    ],
  },
  {
    id: 'git-pro',
    name: 'Git Pro',
    tagline: 'Diffs, staging, branches, history and merge conflicts.',
    icon: 'git-merge',
    productId: `${PRODUCT_PREFIX}.git_pro`,
    fallbackPrice: '$6.99',
    features: [
      'Line-by-line diff for every changed file and every commit',
      'Stage, unstage and discard a whole file or a single hunk',
      'Commit only what is staged',
      'Create, switch and delete branches',
      'Commit history with the files each commit changed',
      'Accept current, incoming or both on merge conflict markers in the editor',
    ],
  },
  {
    id: 'intellisense',
    name: 'IntelliSense Pro',
    tagline: 'TypeScript-powered completions, errors and navigation for JS and TS.',
    icon: 'zap',
    productId: `${PRODUCT_PREFIX}.intellisense`,
    fallbackPrice: '$9.99',
    features: [
      'Completions from the TypeScript language service, including your own modules',
      'Type errors inline as you type',
      'Hover for types and documentation',
      'Go to definition, find references and rename symbol across the project',
    ],
    note: 'JavaScript and TypeScript. Runs on the device, no server needed.',
  },
  {
    id: 'debugger',
    name: 'Debugger',
    tagline: 'Breakpoints and stepping for Node and Python scripts.',
    icon: 'crosshair',
    productId: `${PRODUCT_PREFIX}.debugger`,
    fallbackPrice: '$9.99',
    features: [
      'Tap the gutter to set breakpoints',
      'Continue, pause, step over, step into and step out',
      'Call stack and variables you can expand',
      'Evaluate expressions in the paused frame',
      'A debug console with the program output and input',
    ],
    note: 'Debugs scripts run on the device (Local mode).',
  },
];

export const manifestFor = (id: ExtensionId) => manifests.find((m) => m.id === id)!;
export const manifestForProduct = (productId: string) => manifests.find((m) => m.productId === productId);
