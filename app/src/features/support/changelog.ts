// Shown once after an update (What's new), and from Settings at any time.
// Newest first; add an entry with each release.
export interface Release {
  version: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: '2.0.0',
    items: [
      'Everything in Tide is free: every feature and every extension, with no subscription',
      'Support Tide with an optional tip, in Settings; tips unlock nothing',
      'Up to 6 terminals and 10 snapshots per project, for everyone',
      'Preview HTML files with the eye button: their CSS, scripts and images load, and saving reloads the page',
      'Wrapped lines keep their indentation, and a cleaner look for Settings, Extensions and the projects list',
      'Suggest message: a commit message written by AI from your changes, in Source Control and Git Tools',
      'Breadcrumbs above the editor: the file\'s folders and the function or class the cursor is in; tap to jump',
      'Tide suggests a free extension when a project would use it, such as Format & Lint for a project with ESLint',
      'Tap a file:line in terminal output, like a stack trace or a compiler error, to open the file at that line',
      'One Problems panel for errors from the editor, extensions and the programs you run (tsc, ESLint, pytest, Node and Python), with a count in the terminal bar',
      'Explain the last error with AI: sends the failing output and the file it points at, and suggests a fix',
      'npm run, npm test, npm start and npx in the Local terminal, and package.json scripts as tasks',
      'Built-in CSS, SCSS, LESS, HTML and JSON support: completions, hover docs, error checking and color swatches with a picker, plus checks for package.json, tsconfig.json, .eslintrc, .prettierrc and tide.json',
      'IntelliSense for Python: completions, hover, go to definition, find references and rename, with Jedi on your device',
      'Git: stash changes and apply, pop or drop them later; create, delete and push tags; cherry-pick a commit; rebase onto another branch, with Continue, Skip and Abort on conflicts',
      'Connect to Redis and MongoDB, directly or through SSH: browse keys and documents, edit values, and run Redis commands',
      'Local history: every save of a file is kept, so you can compare and restore earlier versions',
      'Saved SSH commands: run the commands you use on a server with one tap',
      'Live reload swaps stylesheets without reloading, and keeps your scroll position otherwise',
      'Preview pages at phone, tablet and desktop widths, and check their accessibility, SEO and performance',
      'Open CSV, TSV and Parquet files as tables: sort, filter, column stats and charts',
      'New project templates: a static website, a React app, a Python web API, a Node CLI tool and a Lua game',
      'Lua, Ruby and PHP run on the device, offline, next to JavaScript and Python',
      'sqlite3 in the terminal: run SQL on a database file, or at a sqlite> prompt',
      'GitHub: sign in, browse and clone your repositories, review and merge pull requests, work on issues and follow Actions',
      'Comment on lines of a pull request, and see the commits and changes before you open one',
      'Deploy a website to GitHub Pages, Firebase Hosting, Netlify, Vercel or Cloudflare Pages, or start a Render deploy',
      'Deploy automatically when you save or commit, with a history of recent deploys',
      'SSH: a terminal on your own servers and SFTP to browse and edit their files, with ed25519 keys kept in the Keychain',
      'Forward a server port to your device to preview it, and reach servers through a jump host',
      'Send HTTP requests from .http files, switch between dev and prod environments, and save responses',
      'Browse, edit and query SQLite databases and export tables to CSV; see JSON as a collapsible tree',
      'Vim and Emacs key bindings for the editor, in Settings',
      'Paste a cURL command into a .http file, copy any request as cURL, and send GraphQL queries',
      'Environment variables for each project, in .env or kept as secrets in the Keychain',
      'Deploy a preview of your branch to Netlify, Vercel, Cloudflare Pages or Firebase without changing the live site',
      'Connect to PostgreSQL and MySQL, directly or through SSH, to browse, edit and query them',
      'A list of every TODO and FIXME in the project, an outline of each file, and Go to Symbol (⇧⌘O)',
      'Each HTTP request keeps its recent responses, to compare with the latest or send again',
      'Developer tools: format JSON, test regular expressions, convert YAML and CSV, decode JWTs, Base64 and URLs, hashes, UUIDs and timestamps',
      'Search the terminal, Mermaid diagrams in Markdown previews, and export Markdown and notebooks as PDF',
      'Browse OpenAPI and Swagger specs and add their endpoints to a .http file',
      'Connect to WebSocket servers from .http files and send and receive messages',
      'See a database schema, with keys and the relationships between tables',
      'An AI assistant that explains, fixes and changes code with Claude, using your own Anthropic API key',
      'Run the Python cells of Jupyter notebooks on your device',
      'Your own snippets with tab stops, and Emmet in HTML, CSS and JSX',
      'Git blame and the history of each file',
      'GitLab and Bitbucket, with cloning, merge and pull requests, and issues',
      'A Recent Projects widget, deploys as a Live Activity, and Siri and Shortcuts actions',
      'A Midnight app icon, in Settings > Appearance',
      'Security fixes, and updated React Native, Expo, Git and Markdown components',
    ],
  },
  {
    version: '1.0.1',
    items: [
      'cd works with folder names that have spaces, and Tab completion escapes them',
      'The new project sheet scrolls when the keyboard is open and stays below the status bar',
      'Tour buttons fit on every iPhone, including with larger text sizes',
      'Buttons grow with larger text sizes instead of cutting off their labels',
    ],
  },
  {
    version: '1.0.0',
    items: [
      'Open folders from Files and iCloud Drive, and sync changes back',
      'Open files from other apps in Tide, and share files out',
      'Several terminals at once, and a split editor on iPad',
      'Search and replace across the project, with regular expressions',
      'Code folding, indent guides, minimap and word wrap settings',
      'A key bar you can arrange per language, a cursor trackpad and pinch to zoom',
      'Full hardware keyboard shortcuts; press ⇧⌘? to see them all',
      'Preview web servers you start on the device',
      'Export projects as .zip, import them back, and automatic snapshots',
      'tide:// links for Shortcuts, and quick actions on the app icon',
      'Haptics, faster big projects, and Help & feedback in Settings',
    ],
  },
];

// The releases newer than `seen`, or none on a first launch (seen is null).
export function unseenReleases(seen: string | null, current: string, changelog = CHANGELOG): Release[] {
  if (seen === null || seen === current) return [];
  const newer = (a: string, b: string) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
    }
    return false;
  };
  return changelog.filter((r) => newer(r.version, seen) && !newer(r.version, current));
}
