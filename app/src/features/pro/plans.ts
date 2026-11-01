// Tide Pro: what it costs and what it unlocks. Plain data, so tests and the
// App Store notes can read it.
import type { IconName } from '../../components/Button';
import type { ProductKind } from '../../extensions/purchases';

export type PlanId = 'yearly' | 'monthly' | 'lifetime';

export interface Plan {
  id: PlanId;
  productId: string;
  kind: ProductKind;
  title: string;
  // Shown until the App Store returns the localized price.
  fallbackPrice: string;
  // "/ year", "/ month", "once".
  per: string;
}

export const PRO_PREFIX = 'com.thisiskurubaran.tide.pro';

// Yearly first: it's the one with the free trial, and the paywall preselects it.
export const PLANS: Plan[] = [
  { id: 'yearly', productId: `${PRO_PREFIX}.yearly`, kind: 'subs', title: 'Yearly', fallbackPrice: '$24.99', per: '/ year' },
  { id: 'monthly', productId: `${PRO_PREFIX}.monthly`, kind: 'subs', title: 'Monthly', fallbackPrice: '$2.99', per: '/ month' },
  { id: 'lifetime', productId: `${PRO_PREFIX}.lifetime`, kind: 'in-app', title: 'Lifetime', fallbackPrice: '$59.99', per: 'once' },
];

export const planFor = (id: PlanId) => PLANS.find((p) => p.id === id)!;
export const planForProduct = (productId: string) => PLANS.find((p) => p.productId === productId);
export const SUBSCRIPTION_IDS = PLANS.filter((p) => p.kind === 'subs').map((p) => p.productId);

// What free accounts get where Pro lifts a limit.
export const FREE_LIMITS = { snapshots: 3, terminals: 2 } as const;
export const PRO_LIMITS = { snapshots: 10, terminals: 6 } as const;

export type ProFeature =
  | 'linked-folders'
  | 'compare'
  | 'tests'
  | 'devtools'
  | 'split-editor'
  | 'snapshots'
  | 'terminals'
  | 'extensions'
  | 'app-icon'
  | 'snippets'
  | 'shortcuts'
  | 'widgets'
  | 'blame'
  | 'git-hosts'
  | 'notebooks'
  | 'ai';

export const PRO_FEATURES: Record<ProFeature, { icon: IconName; title: string; description: string }> = {
  'linked-folders': { icon: 'folder', title: 'Linked folders', description: 'Open folders from Files and iCloud Drive and sync changes back.' },
  compare: { icon: 'git-merge', title: 'Compare and merge', description: 'Diffs against the last commit or any file, and a merge editor for conflicts.' },
  tests: { icon: 'check-square', title: 'Test runner', description: 'Run node:test, pytest and unittest suites and jump to failures.' },
  devtools: { icon: 'tool', title: 'Preview dev tools', description: "Console and network for the pages you preview." },
  'split-editor': { icon: 'columns', title: 'Split editor', description: 'Two files side by side on iPad.' },
  snapshots: { icon: 'clock', title: 'More snapshots', description: `Keep ${PRO_LIMITS.snapshots} snapshots per project instead of ${FREE_LIMITS.snapshots}.` },
  terminals: { icon: 'terminal', title: 'Up to 6 terminals', description: 'Run a server in one and work in the others.' },
  extensions: { icon: 'package', title: 'Every extension included', description: 'Themes, Format & Lint, Git Pro, IntelliSense and the Debugger.' },
  'app-icon': { icon: 'star', title: 'Pro app icon', description: 'A midnight Tide icon with a gold PRO badge.' },
  snippets: { icon: 'scissors', title: 'Snippets and Emmet', description: 'Your own snippets with tab stops, and Emmet abbreviations in HTML, CSS and JSX.' },
  shortcuts: { icon: 'zap', title: 'Siri and Shortcuts', description: 'Run a task, deploy or send a request from Siri and the Shortcuts app.' },
  widgets: { icon: 'grid', title: 'Widgets and Live Activities', description: 'Recent projects on your Home Screen, and deploys on the Lock Screen.' },
  blame: { icon: 'clock', title: 'Blame and file history', description: 'Who last changed each line, and every earlier version of a file.' },
  notebooks: { icon: 'book-open', title: 'Run notebooks', description: "Run a Jupyter notebook's Python cells on your device and save their output." },
  ai: { icon: 'cpu', title: 'AI assistant', description: 'Explain, fix and write code with Claude, using your own Anthropic API key.' },
  'git-hosts': { icon: 'git-branch', title: 'GitLab and Bitbucket', description: 'Clone, merge requests, pull requests and issues from GitLab and Bitbucket.' },
};

