# Tide

Tide is a mobile IDE for Android and iOS built with React Native. It has a code editor, a file manager and a terminal that runs Node.js and Python, both locally on the device and in a remote container.

## Repo layout

```
app/                             Expo app (dev client, prebuild, New Architecture)
  src/app                        Expo Router routes (projects list, project, debug)
  src/features/files             Workspace service, project templates, file tree
  src/features/projects          Projects list screen
  src/features/project           Project screen: tabs, file view, terminal panel
  src/state                      Zustand stores (projects, tabs, runner mode, open-file buffers)
  src/runtime                    Clients for the embedded Node and Python runtimes
  src/theme                      Tokens from the FuseOps theme, theme hooks, editor and terminal themes
  src/features/settings          Settings screen
  src/features/search            Project search, quick open and command palette
  assets/fonts                   Inter, Instrument Sans, JetBrains Mono (SIL OFL 1.1)
  assets/brand                   Logo SVGs (mark, wordmark, logo; light, dark, mono)
  assets/icons                   App icons and splash images, built from the mark
  src/features/editor            Editor WebView, bridge types, generated editor HTML
  src/features/terminal          Terminal WebView, mini-shell, generated terminal HTML
  src/features/remote            Remote mode: server settings, file sync, remote shell, preview
  web/editor                     CodeMirror 6 editor bundle (Vite, single HTML file); CSS/SCSS/LESS, HTML and JSON language services (web/editor/langservices) with bundled config-file schemas, built in and offline
  web/terminal                   xterm.js terminal bundle (Vite, single HTML file)
  nodejs-assets/nodejs-project   Supervisor inside nodejs-mobile: runs each script in a worker thread; npm, pip, git, ssh, sql and lua built-ins
  src/features/git               Git settings, Source Control sheet, running git from the UI
  src/features/github            GitHub sign-in (device flow), repositories, pull requests, issues, Actions
  src/features/deploy            Publishing a folder to GitHub Pages, Firebase Hosting, Netlify, Vercel, Cloudflare Pages; Render deploy hooks
  src/features/ssh               SSH servers and keys, the SSH terminal backend, SFTP browsing and editing
  src/features/http              .http request files: parsing, sending, environments, cURL and GraphQL, WebSockets, the request/response viewer
  src/features/database          Database viewer for SQLite files (expo-sqlite), PostgreSQL / MySQL servers (tide:sql) and Redis / MongoDB servers (tide:redis, tide:mongo), in remote/; schema view
  src/features/tools             Developer tools: JSON, regex tester, YAML/CSV, Base64, URL, JWT, hashes, UUIDs, timestamps
  src/features/openapi           OpenAPI / Swagger viewer: endpoints with example bodies, added to a .http file
  src/features/history           Local history: earlier versions of each file, kept on save under .tide/history
  src/features/data              CSV, TSV and Parquet viewer (hyparquet): sort, filter, column stats, charts
  src/features/docs              Offline docs downloaded from DevDocs, searched and read without a network
  src/features/todos             The TODO / FIXME list
  src/features/outline           File outline and Go to Symbol (symbols read line by line, per language)
  src/features/notebook          Running Jupyter notebook cells with the device's Python
  src/features/ai                AI assistant: Claude through @anthropic-ai/sdk with the user's own key
  src/features/env               Per-project environment variables: .env plus Keychain secrets, given to every run
  src/features/hosts             GitLab and Bitbucket: accounts, repositories, merge/pull requests, issues
  src/features/widgets           Shares data with the widget and Shortcuts actions; deploy Live Activities
  modules/tide-widgets           Expo module: app group data for the widget, ActivityKit for the deploy Live Activity
  targets/widget                 Widget extension (@bacons/apple-targets): Recent Projects widget, deploy Live Activity
  native/ios                     Siri and Shortcuts actions (App Intents), added to the app target by plugins/withAppIntents.js
  src/runtime/wasm               Ruby and PHP: a hidden web view running their WebAssembly builds (web/runtimes, assets/runtimes)
  src/features/privacy           Opt-in crash reports (Sentry) and the scrubbing applied to them
  .maestro                       End-to-end flows (Maestro)
  modules/python-runtime         Expo module: Chaquopy on Android, CPython on iOS; python/tide_runner.py runs scripts
  src/extensions                 Extensions: the extension API, the Extensions screen and each extension
server/                          Remote mode server: one Docker container per project
shared/protocol.ts               Runner message types, imported as @shared/protocol
```

`app/ios` and `app/android` are generated by `npx expo prebuild` and are not committed.

On the device, projects are stored under `Documents/projects/<name>`, and app state (open tabs, runner mode) under `Documents/.tide`. Each project has a `tide.json` with its run config (`runtime` and `entry`). It can also list named run configurations and tasks, which show up in the command palette:

```json
{
  "runtime": "node",
  "entry": "index.js",
  "configurations": [{ "name": "Server", "entry": "server.js", "args": ["--port", "3000"] }],
  "tasks": [
    { "name": "Test", "command": "node --test" },
    { "name": "Lint", "local": "node lint.js", "remote": "npx eslint ." },
    { "name": "Watch", "remote": "npm run watch", "newTerminal": true }
  ]
}
```

⌘R runs the configuration picked last ("Run configuration: …" in the palette), or the default. Tasks type their command into the terminal; `local` and `remote` replace `command` for that terminal mode, and `newTerminal` opens a terminal tab for it. In Remote mode, `package.json` scripts are listed as tasks too.

On macOS, `npm install` downloads the CPython iOS XCframework (about 86 MB) into `app/modules/python-runtime/ios/Python.xcframework`. It is checksum-verified and not committed.

`npm install` also builds the code the extensions run in the Node supervisor (Prettier, ESLint and TypeScript, about 5 MB, by `scripts/build-services.js`) and fetches pyflakes, autopep8 and pycodestyle (checksum-pinned wheels) into `app/modules/python-runtime/python`. None of it is committed. Run `npm run build:services` after upgrading prettier, eslint or typescript.

## Requirements

- Node.js 20 or newer
- iOS builds: Xcode (selected with `xcode-select`) and CocoaPods
- Android builds: Android Studio with JDK 17, SDK and NDK

Native modules are used, so Expo Go cannot run the app. Use a development build, either locally or in the cloud with EAS Build:

```bash
cd app
npx eas-cli@latest build --profile development --platform android
```

The Android profile produces an APK you can install directly. iOS cloud builds need an Apple Developer account to sign for a physical device.

## Running

```bash
cd app
npm install
npm run ios       # or: npm run android
```

### From Xcode

Generate the native project once (and again after changing `app.json`, a config plugin or a native dependency), then open the workspace, not `Tide.xcodeproj`: the project alone does not include the CocoaPods targets.

```bash
cd app
npx expo prebuild --clean --platform ios
open ios/Tide.xcworkspace
```

Signing uses the team in `app.json` (`ios.appleTeamId`). The Debug configuration is a development client: start Metro first with `npx expo start --dev-client`, then run. For a build with the JavaScript bundled in, edit the scheme and set Run to the Release configuration.

## Terminal

The terminal has two modes, switched in its header. Local mode is a small built-in shell, not a real one (iOS can't start processes). It has `ls cd pwd cat echo touch mkdir rm mv cp clear help`, plus `node <file>`, `python <file>` and `run [name]`, which starts the entry (or a named configuration) in the project's `tide.json`, and the `npm`, `pip` and `git` described below. Anything else needs Remote mode.

Node scripts run in nodejs-mobile (Node 18), each in its own worker thread, so Ctrl-C stops a script without restarting Node. Each run is capped at 256 MB of heap. Leaving a project stops whatever its terminal was running.

nodejs-mobile's Node is built without Intl: there is no `Intl` object and regular expressions with Unicode property escapes (`\p{...}`) fail. Packages that rely on either, such as Express 5, don't run locally; the Express template uses Express 4 for this reason. Likewise the Python web API template uses Bottle rather than Flask: Flask needs MarkupSafe, which has no pure-Python wheel, so `pip install flask` only works in Remote mode. The React template loads React from esm.sh with an import map, because Vite and esbuild are native binaries that can't run on the device.

Python scripts run in the embedded CPython 3.15 (Chaquopy on Android), each on its own thread with `input()` wired to the terminal. Ctrl-C raises `KeyboardInterrupt` in the script. Project modules are reloaded on every run, and tracebacks show paths from the project root. On iOS the app ships the standard library without `tkinter`, `turtledemo`, `ensurepip`, CPython's own test modules and the `-O` bytecode, which saves about 28 MB.

`pip install <package>...` (also `pip install -r requirements.txt`, `pip uninstall`, `pip list` and `python -m pip`) installs pure-Python wheels from PyPI into the project's `.pylibs` folder, which is on `sys.path` for every run. It resolves dependencies, extras and environment markers for the device and checks each wheel's sha256. Packages that only ship compiled wheels need Remote mode. pip itself runs in the Node supervisor, next to npm. Python scripts can make HTTPS requests with the standard library or `requests`.

`npm install [package...]` and `npm uninstall <package...>` work locally for pure-JS packages (uninstall also removes what only that package needed): it resolves versions from the registry, checks each tarball's integrity and extracts it into `node_modules`. Install scripts never run, and packages that need a native build print a warning; install those in Remote mode.

## Editor

The search icon in a project searches every file (skipping `node_modules`, `.git`, `.pylibs` and binary files), and tapping a result opens the file at that line. The command icon opens the command palette: delete the `>` to switch to quick open, which matches file paths as you type. Go to line is in the palette.

On an iPad, or any screen at least 768 points wide, the file tree stays open on the left, and the app rotates to landscape. With a hardware keyboard, the editor and terminal pass these shortcuts to the app: ⌘P quick open, ⇧⌘P command palette, ⇧⌘F search in project, ⌘L go to line, ⌘J show or hide the terminal, ⌘S save. They only work while the editor or the terminal has focus. In the iOS Simulator, turn on I/O, Keyboard, Send Keyboard Shortcuts to Device; even then the Simulator keeps ⌘S (save screenshot) and ⌘L (lock) for itself.

## Settings

Settings (the gear on the projects list) has the theme (System, Light or Dark, all from the FuseOps tokens), the editor and terminal font sizes, Git, the Remote server and, in builds set up for it, crash reports.

## Crash reports

Crash reports go to Sentry and are off until the user turns on Settings, Privacy, Send crash reports. A build only offers the setting when `EXPO_PUBLIC_SENTRY_DSN` is set at build time (for a dev client, when Metro starts):

```sh
EXPO_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project> npx expo start --dev-client
```

Without it, Sentry is never started. When it is on, reports carry no breadcrumbs, user data, request data, screenshots or view hierarchy, and any path under Documents (which would name a project or file) is replaced with `<documents>`. Native crash reports also include the random installation ID the Sentry SDK generates. Source maps are not uploaded, so JS stack traces from release builds are minified.

## Help and feedback

Settings, Help & feedback offers Report a problem, Suggest a feature, Rate Tide and What's new. Reports open a mail draft addressed to the support address (`EXPO_PUBLIC_SUPPORT_EMAIL` at build time overrides it), with device details and the session's recent warnings and errors attached as a text file. The user sees the whole draft before sending, and sandbox paths are shortened to `~`. Without mail on the device, the report goes to the share sheet instead.

The rating prompt is asked for at most once per version, after 5 runs and 3 days of use. Add each release's notes to `src/features/support/changelog.ts`; What's new shows them once after an update.

The iOS privacy manifest is set in `app.json` (`ios.privacyManifests`) and declares crash data and the required-reason APIs the app and its Node and Python runtimes use (user defaults, file timestamps, boot time and disk space). `ios.config.usesNonExemptEncryption` is false: the app only uses standard encryption.

## Pricing

Tide is free: every feature and every extension, with no subscription or sign-up. Limits that remain are there for performance: up to 6 terminals per project and 10 snapshots per project.

The only purchases are optional tips (Settings, Support Tide; `src/features/tips`): three consumable in-app purchases, `com.thisiskurubaran.tide.tip.small`, `.medium` and `.large` ($1.99, $4.99, $9.99). They unlock nothing. They go through expo-iap (its config plugin is in `app.json`); `app/storekit/Tide.storekit` lists them for testing in Xcode, and a test keeps the two in step.

[appstore/release.md](appstore/release.md) covers the App Store Connect setup, the privacy label and the review notes. The privacy policy ([appstore/site/tide/privacy.md](appstore/site/tide/privacy.md)) and support page ([appstore/site/tide/support.md](appstore/site/tide/support.md)) are published with GitHub Pages at `https://thisiskurubaran.github.io/tide/privacy/` and `/tide/support/`. `appstore/site/` is the whole site, one directory per app, with a template for adding other apps; appstore/release.md has the steps.

## Remote mode

Remote mode runs the project in a container on a Tide server you host (see below). Set the server URL and token under Settings, Remote server; both are kept in the Keychain (Keystore on Android).

When a project's terminal switches to Remote, the app starts or reuses the project's container, uploads the project's files, and then opens a real bash shell in `/workspace`. After that, files sync both ways: saves, new files and deletes on the phone go to the container, and changes made in the container come back to the phone. Changes to a file with unsaved edits on the phone don't overwrite those edits. `node_modules`, `.git`, `.pylibs` and `__pycache__` are not synced, and neither is any file over 2 MB.

When something in the container listens on a port, a button such as `:3000` appears in the terminal header and opens that port in an in-app browser.

The simulator reaches a server on the same Mac at `localhost:8787`. On a phone, use the Mac's LAN address and start the server with `HOST=0.0.0.0`.

## Remote server

Remote mode runs a real bash shell in a Docker container on a machine you control. The server needs Node 24 or newer (it runs its TypeScript directly) and a Docker daemon.

```bash
cd server
npm install
npm run image                    # builds tide-session:dev (Node 24, Python 3, git, build tools)
TIDE_TOKEN=<at least 16 characters> npm start
```

Other settings: `HOST`, `PORT` (8787), `TIDE_IMAGE`, `TIDE_IDLE_MINUTES` (15), `TIDE_MEMORY_MB` (1024), `TIDE_CPUS` and `TIDE_PIDS`.

- Every request needs `Authorization: Bearer <token>`. `POST /sessions {"project"}` starts or reuses that project's container; `DELETE /sessions/:id` removes it.
- `/sessions/:id/pty` is a WebSocket to bash. `/sessions/:id/sync` syncs files both ways and reports listening ports.
- Containers run as a non-root user with no capabilities, no privileged mode, memory, CPU and process limits, and no published ports. A container with no open connections is removed after the idle timeout, and leftovers are removed when the server starts.
- Previews are served at `/p/<previewKey>/<port>/`. The key is random and stands in for the token, because a WebView can't send headers. Pages that link to absolute paths like `/app.js` break under this prefix.

`npm test` in `server/` runs integration tests against the local Docker daemon; build the image first.

## Git

`git` in the Local terminal runs isomorphic-git in the Node supervisor. It supports `clone` (HTTPS, shallow, single branch), `init`, `status [-s]`, `add`, `rm`, `commit [-a] -m`, `log [--oneline]`, `diff` (a `--stat` summary only), `branch`, `checkout [-b]`, `remote [-v|add]`, `push [remote] [branch|tag] [--tags]`, `pull`, `stash [push [-u] [-m msg] | list | show | apply | pop | drop | clear]`, `tag [-l] | [-a] <name> [-m msg] [commit] | -d <name>`, `cherry-pick <commit> | --continue | --abort` and `rebase <upstream> | --continue | --skip | --abort` (`git/stash.js`, `git/sequencer.js`, with a line-level three-way merge in `git/merge3.js`). Conflicts are left as markers in the files. Interactive rebase, `--onto`, submodules and other commands need the real git in Remote mode.

Set a name, email and personal access token under Settings, Git. They are kept in the Keychain and passed to each git run as environment variables, never written into the project. The token is sent as the HTTPS password, which works for GitHub, GitLab and Gitea. Signed-in GitLab and Bitbucket accounts add their own token for their host, in `TIDE_GIT_HOSTS`. `git __tide blame` and `file-log` give the blame and file history; isomorphic-git has no blame, so `git/blame.js` works it out from the file's versions.

The branch icon in a project opens Source Control, which shows the changed files and can commit everything, push and pull. New project, Clone from Git clones a repository into a new project.

isomorphic-git is bundled into `app/nodejs-assets/nodejs-project/git/isogit.js`, which is committed. After upgrading it, rebuild the bundle:

```bash
cd app
npm run build:git
```

ssh2 is bundled the same way into `app/nodejs-assets/nodejs-project/ssh/ssh2.js`. nodejs-mobile on iOS has no WebAssembly, so the bundle swaps ssh2's WebAssembly poly1305 for a stub and `tide:ssh` turns the chacha20-poly1305 cipher off. After upgrading ssh2:

```bash
npm run build:ssh
```

Lua is fengari (Lua 5.3 in plain JavaScript), bundled into `app/nodejs-assets/nodejs-project/lua/fengari.js` by `npm run build:lua` and run by the `tide:lua` built-in, which adds `io.read`, `io.lines` and `io.open`.

PostgreSQL and MySQL go through `tide:sql`, which holds one connection open with pg and mysql2 bundled into `app/nodejs-assets/nodejs-project/sql/drivers.js` (`npm run build:sql`, committed). Through SSH, the app forwards a local port with `tide:ssh` first. `src/features/database/remote/dialect.test.ts` runs against real servers when `TIDE_TEST_POSTGRES` and `TIDE_TEST_MYSQL` are set (JSON connection settings), and skips otherwise. Redis goes through `tide:redis`, a small RESP client with no driver; MongoDB goes through `tide:mongo`, with the official driver (6.x, for Node 18) bundled into `mongo/driver.js` by the same `npm run build:sql`. `redis.test.ts` and `mongo.test.ts` use real servers when `TIDE_TEST_REDIS` / `TIDE_TEST_MONGO` are set; the Mongo tests also run against a built-in fake server that speaks the wire protocol.

The widget, the deploy Live Activity and the Siri and Shortcuts actions are native: `targets/widget` is a widget extension made by `@bacons/apple-targets` at prebuild, `modules/tide-widgets` writes what it shows to the app group `group.com.thisiskurubaran.tide` and runs ActivityKit, and `native/ios/TideIntents.swift` (App Intents) is copied into the app target by `plugins/withAppIntents.js`. The actions open `tide://` links the app handles. The app group needs registering for both bundle IDs in the Apple Developer portal.

Ruby (CRuby 3.4, ruby.wasm) and PHP (8.3, php-wasm) need WebAssembly, which neither Hermes nor nodejs-mobile has on iOS, so they run in a hidden web view (`src/runtime/wasm`). The page is `web/runtimes`, built into `app/assets/runtimes/runtime.html` by `npm run build:runtimes` and committed; `npm install` copies the interpreters (`ruby.wasm`, 31 MB, and `php.wasm`, 18 MB) next to it from node_modules, and they aren't committed. Each run copies the project into the interpreter's virtual disk and writes back what changed. Programs can't read the terminal (input ends at once). `npm run test:runtimes` checks the page in Chromium.

Markdown previews draw ```mermaid blocks as diagrams. `npm install` (via `build-runtimes.js`) copies Mermaid into `app/assets/mermaid/mermaid.js.txt`, which is not committed; the preview loads it only when a document has a diagram and runs it under a nonce-only script policy, so scripts written in the document never run.

## Extensions

Extensions are free add-ons. Their code ships inside the app and installing one only switches it on, so nothing executable is downloaded. The Extensions screen (Extensions on the projects list, or Settings) shows each one with what it adds, Install or Remove, and its settings once installed.

| Extension | What it adds |
|---|---|
| Themes & Icons Pack | Seven editor and terminal themes (Dracula, One Dark, Monokai, Nord, Solarized Dark and Light, GitHub Light) and file icons in the tree and tabs. Color theme in the command palette. |
| Format & Lint | Format document (⇧⌥F) with Prettier for JS, TS, JSON, CSS, HTML, Markdown and YAML and autopep8 for Python, optionally on save. ESLint (recommended rules) and pyflakes warnings as you type, and a Problems panel. A JSON Prettier config in the project is used. |
| Git Tools | Replaces the Source Control sheet: staged and unstaged changes, diffs, staging, unstaging and discarding a file or a single hunk, commit only what is staged, branches (create, switch, delete, merge), history with each commit's diff, and Accept current / incoming / both on conflict markers in the editor. |
| IntelliSense | Completions, hover, go to definition (F12 or Cmd-click), find references and rename symbol across the project. JavaScript and TypeScript use the TypeScript language service (with inline type errors and the project's tsconfig.json or jsconfig.json); Python uses Jedi (`python/tide_jedi.py`, one long-lived worker in the app's Python), including packages in `.pylibs` and the standard library. jedi and parso are checksum-pinned wheels fetched at `npm install`, without typeshed's third-party stubs. |
| Debugger | Gutter breakpoints, Debug: start for the open JavaScript or Python file (or the tide.json entry), continue, pause, step over, into and out, variables, call stack, and a console for output, input and evaluating expressions. |

How they run:

- Prettier, ESLint and the TypeScript language service are long-lived workers in the Node supervisor that answer JSON requests on stdin (`nodejs-project/service.js`, `format/`, `intellisense/`). They start on first use and work in Local and Remote mode, because the files are on the device. The TypeScript service can take a few seconds for its first answer on a phone.
- Python formatting and linting run in the app's Python through `tide_runner.snippet`, so the native modules didn't change.
- The Node debugger debugs each run's worker thread from the supervisor's main thread over the inspector's NodeWorker domain (`nodejs-project/debugger.js`). The Python debugger is bdb from the standard library (`python/tide_debugger.py`). Debugging runs on the device, not in the Remote container. Exceptions don't pause the program; they print their stack trace and end the run, as without the debugger.

The extension API is in `src/extensions/types.ts`: an extension can add palette commands, panels, a bar under the tabs, editor features, a language provider (completions, hover, definition), a hook before explicit saves, and a listener for open files' text, which is how linting and type checking report into the Problems panel.

## WebView bundles

The editor (CodeMirror 6) and the terminal (xterm.js) each run inside a WebView. Their sources are in `app/web/editor` and `app/web/terminal`, and `npm run build:web` builds each with Vite into one HTML file, written to `app/src/features/<name>/<name>Html.generated.ts`. The generated files are committed, so rebuild them after changing anything in `app/web`:

```bash
cd app
npm run build:web
```

## Icons

App icons and splash images are generated from `app/assets/brand/tide-mark.svg`, including the Midnight alternate icon (midnight tile, gold wave), which anyone can pick in Settings, Appearance, App icon. After changing the mark:

```bash
cd app
npm run build:icons
```

## Tests

Jest covers the logic:

```bash
cd app
npm test
```

### End-to-end flows

`app/.maestro` has Maestro flows for creating a project, editing and running Node, running Python with input, and running in Remote mode. They start from a cleared app, which also clears a dev client's link to Metro, so run them against a Release build on a simulator.

Install Maestro (`brew install mobile-dev-inc/tap/maestro`). It needs Java; Homebrew's OpenJDK is not linked, so point `JAVA_HOME` at it:

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
```

Build the Release app for the simulator:

```bash
cd app/ios
xcodebuild -workspace Tide.xcworkspace -scheme Tide -configuration Release -sdk iphonesimulator build
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/Tide-*/Build/Products/Release-iphonesimulator/Tide.app
```

Then run the local flows, and the remote one with a server running (see Remote server):

```bash
cd app
npm run e2e
maestro test -e TIDE_SERVER_URL=http://localhost:8787 -e TIDE_SERVER_TOKEN=<token> .maestro/remote-run.yaml
```

The flows read the terminal through xterm.js's screen reader mode, which also lets VoiceOver read terminal output.
