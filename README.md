<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="app/assets/brand/tide-logo-dark.svg">
  <img src="app/assets/brand/tide-logo.svg" alt="Tide" width="64">
</picture>

</br>

**A full mobile IDE for iPhone, iPad and Android.**<br>
Code editor, file manager and terminal, with Node.js, Python, Lua, Ruby and PHP running on the device, offline, and a real Linux shell in a container you host.

![Version](https://img.shields.io/badge/version-2.0.0-3b5bdb)
![Platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20iPadOS%20%7C%20Android-0e1a4d)
![Price](https://img.shields.io/badge/price-free-2f9e44)
![Expo SDK](https://img.shields.io/badge/Expo%20SDK-58-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.88-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-5fa04e?logo=nodedotjs&logoColor=white)
![Tests](https://img.shields.io/badge/tests-Jest%20%7C%20node%3Atest%20%7C%20unittest%20%7C%20Maestro-c21325?logo=jest&logoColor=white)

[Features](#features) · [Getting started](#getting-started) · [Architecture](#architecture) · [Remote mode](#remote-mode) · [Testing](#testing) · [Releasing](#releasing)

</div>

---

## Features

| Area | What you get |
|---|---|
| **Editor** | CodeMirror 6 with highlighting, folding and Outline for JS/TS, Python, Go, Rust, Java, C/C++, C#, Kotlin, Swift, Dart, PHP, Ruby, Lua, SQL, web and config languages, IntelliSense for JS/TS (TypeScript language service) and Python (Jedi), Vim and Emacs bindings, Emmet, snippets, breadcrumbs, peek definition, minimap and a split editor on iPad |
| **Run on the device** | Node.js 18 (nodejs-mobile), CPython 3.15, Lua 5.3, Ruby 3.4 and PHP 8.3, offline. TypeScript runs directly. `npm`, `pip` and `git` built in |
| **Remote mode** | A real bash shell in a Docker container on your own server, with two-way file sync and port previews |
| **AI, with your own key** | Agent mode, inline completions, Fix with AI, explain errors and commit messages, using Anthropic, OpenAI, Gemini or OpenRouter, or your own Ollama or LM Studio server. Keys stay in the Keychain |
| **Git and hosting** | Stash, tags, cherry-pick, rebase, blame and history on the device. GitHub, GitLab and Bitbucket: clone, pull requests, issues and Actions |
| **Ship it** | Deploy to GitHub Pages, Firebase Hosting, Netlify, Vercel or Cloudflare Pages, or trigger a Render deploy, by hand or on save or commit |
| **Built-in tools** | `.http` requests with environments, GraphQL and WebSockets; SQLite, PostgreSQL, MySQL, Redis and MongoDB clients; SSH and SFTP; a CSV/Parquet viewer; offline docs; Jupyter notebooks; developer utilities |
| **Native integrations** | Live Activity and Dynamic Island while code runs, home screen widget, Siri and Shortcuts actions, Control Center buttons and `tide://` links |

Every feature and every extension is free, with no subscription, sign-up or in-app purchases.

## Contents

- [Getting started](#getting-started)
- [Architecture](#architecture)
- [Project configuration](#project-configuration)
- [Terminal and runtimes](#terminal-and-runtimes)
- [Editor](#editor)
- [Extensions](#extensions)
- [Git](#git)
- [AI](#ai)
- [Remote mode](#remote-mode)
- [Remote server](#remote-server)
- [Native features](#native-features)
- [Privacy, crash reports and feedback](#privacy-crash-reports-and-feedback)
- [Generated bundles](#generated-bundles)
- [Testing](#testing)
- [Releasing](#releasing)

## Getting started

### Requirements

| Tool | Version | For |
|---|---|---|
| Node.js | 20 or newer (24 or newer for the server) | Everything |
| Xcode + CocoaPods | Current, selected with `xcode-select` | iOS builds |
| Android Studio | JDK 17, SDK and NDK | Android builds |
| Docker | Any recent daemon | Remote server only |

Tide uses native modules, so **Expo Go can't run it**. Use a development build.

### Install and run

```bash
cd app
npm install
npm run ios       # or: npm run android
```

`npm install` also prepares files that aren't committed:

- **CPython for iOS** (macOS only): the iOS XCframework, about 86 MB, checksum-verified, into `app/modules/python-runtime/ios/Python.xcframework`.
- **Extension services**: the Prettier, ESLint and TypeScript code the extensions run in the Node supervisor (about 5 MB, `scripts/build-services.js`). Run `npm run build:services` after upgrading any of them.
- **Python tools**: pyflakes, autopep8, pycodestyle, jedi and parso as checksum-pinned wheels into `app/modules/python-runtime/python`.
- **Ruby, PHP and Mermaid**: the `ruby.wasm` and `php.wasm` interpreters, and Mermaid, copied from `node_modules`.

### Development builds in the cloud

```bash
cd app
npx eas-cli@latest build --profile development --platform android
```

The Android profile produces an APK you can install directly. iOS cloud builds need an Apple Developer account to sign for a physical device.

### From Xcode

Generate the native project once, and again after changing `app.json`, a config plugin or a native dependency. Open the **workspace**, not `Tide.xcodeproj`: the project alone doesn't include the CocoaPods targets.

```bash
cd app
npx expo prebuild --clean --platform ios
open ios/Tide.xcworkspace
```

Signing uses the team in `app.json` (`ios.appleTeamId`). The Debug configuration is a development client: start Metro first with `npx expo start --dev-client`, then run. For a build with the JavaScript bundled in, set the scheme's Run action to Release.

`app/ios` and `app/android` are generated by `npx expo prebuild` and aren't committed.

## Architecture

```
app/                              Expo app (dev client, prebuild, New Architecture)
├─ src/app                        Expo Router routes
├─ src/state                      Zustand stores: projects, tabs, buffers, settings, runner
├─ src/runtime                    Clients for the embedded runtimes (node, python, wasm, lua)
├─ src/features/                  One folder per feature, e.g.
│  ├─ editor, terminal            WebView hosts, bridges and generated HTML
│  ├─ files, project, projects    Workspace service, templates, file tree, project screen
│  ├─ ai, agent                   Bring-your-own-key AI, agent mode and pending-change review
│  ├─ git, github, hosts          Source Control, GitHub, GitLab and Bitbucket
│  ├─ remote                      Remote mode: settings, file sync, remote shell, preview
│  ├─ deploy, http, database      Deploys, .http requests, database clients
│  └─ …                           ssh, docs, data, notebook, history, problems, search, tools, widgets…
├─ src/extensions                 Extension API, Extensions screen and each extension
├─ src/theme                      Design tokens, theme hooks, editor and terminal themes
├─ web/                           WebView bundles built with Vite into single HTML files
│  ├─ editor                      CodeMirror 6 plus CSS/SCSS/LESS, HTML and JSON language services
│  ├─ terminal                    xterm.js
│  └─ runtimes                    Ruby (ruby.wasm) and PHP (php-wasm)
├─ nodejs-assets/nodejs-project   Supervisor inside nodejs-mobile: each script in a worker thread;
│                                 npm, pip, git, ssh, sql, redis, mongo and lua built-ins
├─ modules/python-runtime         Expo module: Chaquopy on Android, CPython on iOS
├─ modules/tide-widgets           Expo module: app group data and ActivityKit
├─ targets/widget                 Widget extension: Recent Projects, deploy Live Activity
├─ native/ios                     Siri and Shortcuts actions (App Intents)
└─ .maestro                       End-to-end flows
server/                           Remote mode server: one Docker container per project
shared/protocol.ts                Message types shared by app and server (@shared/protocol)
```

On the device, projects live under `Documents/projects/<name>` and app state (open tabs, settings, history) under `Documents/.tide`.

## Project configuration

Each project has a `tide.json` with its run config. Named configurations and tasks show up in the command palette:

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

- **⌘R** runs the configuration picked last ("Run configuration: …" in the palette), or the default.
- **Tasks** type their command into the terminal. `local` and `remote` replace `command` for that terminal mode, and `newTerminal` opens a terminal tab for the task.
- **`package.json` scripts** are listed as tasks too, in both modes.

## Terminal and runtimes

The terminal has two modes, switched in its header.

**Local** is a small built-in shell, because iOS can't start processes. It has `ls cd pwd cat echo touch mkdir rm mv cp clear help`, plus:

- `node <file>`, `python <file>`, `lua <file>`, `ruby <file>`, `php <file>`
- `run [name]`, which runs the entry, or a named configuration from `tide.json`
- `npm`, `npx`, `pip`, `git` and `sqlite3`

It also runs `npm run`, `npm test`, `npm start` and `npx` for scripts made of commands it has: node, python, the built-ins, and package binaries from `node_modules`. Those can be joined with `&&` or `;`, with `FOO=bar` prefixes and pre/post scripts. Pipes, `||` and command substitution need **Remote** mode.

| Runtime | Engine | Notes |
|---|---|---|
| Node.js | nodejs-mobile (Node 18) | Each run is a worker thread with a 256 MB heap and its own working folder, so Ctrl-C stops a script without restarting Node. Built without `Intl`, so `Intl` and `\p{…}` regexes fail (Express 5 doesn't run; the template uses Express 4) |
| Python | CPython 3.15 (Chaquopy on Android) | Each run is a thread with `input()` wired to the terminal; Ctrl-C raises `KeyboardInterrupt`. Project modules reload on every run. The iOS build drops `tkinter`, `turtledemo`, `ensurepip`, CPython's tests and `-O` bytecode (about 28 MB) |
| Ruby, PHP | ruby.wasm (CRuby 3.4), php-wasm (8.3) | Run in a hidden web view, since Hermes and nodejs-mobile have no WebAssembly on iOS. The project is copied into the interpreter's virtual disk and changes are written back. No terminal input |
| Lua | fengari (Lua 5.3 in JavaScript) | Run by the `tide:lua` built-in, which adds `io.read`, `io.lines` and `io.open` |

### Packages

- **`npm install [pkg…]` and `npm uninstall`** handle pure-JS packages. They resolve versions from the registry, check each tarball's integrity and extract it into `node_modules`; uninstall also removes what only that package needed. Install scripts never run; packages that need a native build print a warning and need Remote mode.
- **`pip install <pkg…>`**, plus `-r requirements.txt`, `uninstall`, `list` and `python -m pip`, installs pure-Python wheels from PyPI into the project's `.pylibs` folder, which is on `sys.path` for every run. It resolves dependencies, extras and environment markers, and checks each wheel's sha256. pip runs in the Node supervisor, next to npm.
- Flask needs MarkupSafe, which has no pure-Python wheel, so the Python web API template uses Bottle. The React template loads React from esm.sh with an import map, because Vite and esbuild are native binaries.

## Editor

- **Search and navigation**
  - **Search** covers every file, skipping `node_modules`, `.git`, `.pylibs` and binaries, and tapping a result opens the file at that line.
  - **Command palette** (⇧⌘P) searches commands (`>`), files, symbols (`@`), lines (`:`) and text (`#`).
- **Problems panel**, opened from the palette or the ⚠ count in the terminal bar, collects errors and warnings from three places:
  - the editor's CSS/HTML/JSON services;
  - the extensions (ESLint, pyflakes, TypeScript);
  - program output, read by matchers in `src/features/problems/matchers.ts` for tsc, ESLint, pytest, Python tracebacks, Node errors and `path:line:col: error:` lines.
- **Terminal links**: `file:line[:col]` references in terminal output are underlined and open the file at that line when tapped (`src/features/terminal/fileRefs.ts`).
- **Breadcrumbs** show the file's folders and the symbols around the cursor (`src/features/outline/breadcrumbs.ts`).
- **Extension suggestions** (`src/extensions/suggest`): when a project would benefit from an extension it doesn't have, a banner offers it. "Not now" is remembered per project.
- **Keyboard shortcuts**: ⌘P quick open, ⇧⌘P palette, ⇧⌘F search, ⌘L go to line, ⌘J terminal, ⌘S save, and ⇧⌘? to list them all. In the iOS Simulator, turn on *I/O → Keyboard → Send Keyboard Shortcuts to Device*; the Simulator still keeps ⌘S and ⌘L for itself.
- **iPad layout**: on screens 768 points or wider, the file tree stays open on the left and the app rotates to landscape.

## Extensions

Extensions are free add-ons. Their code ships inside the app, and installing one only switches it on: nothing executable is downloaded.

| Extension | What it adds |
|---|---|
| Themes & Icons Pack | Dracula, One Dark, Monokai, Nord, Solarized Dark and Light, and GitHub Light for the editor and terminal, plus file icons |
| Format & Lint | Prettier for JS, TS, JSON, CSS, HTML, Markdown and YAML, and autopep8 and Ruff for Python, optionally on save. ESLint and pyflakes warnings as you type |
| Git Tools | Staged and unstaged changes, hunk staging and discarding, branches, history with diffs, conflict resolution in the editor |
| IntelliSense | Completions, hover, go to definition, find references and rename. TypeScript language service for JS/TS; Jedi for Python, including `.pylibs` |
| Debugger | Breakpoints, stepping, variables, call stack and a console, for JavaScript and Python on the device |

How they run:

- **Prettier, ESLint and TypeScript** are long-lived workers in the Node supervisor that answer JSON on stdin (`nodejs-project/service.js`, `format/` and `intellisense/`).
- **Python formatting and linting** run in the app's Python through `tide_runner.snippet`.
- **The Node debugger** drives each run's worker over the inspector's NodeWorker domain (`nodejs-project/debugger.js`).
- **The Python debugger** is `bdb` from the standard library (`python/tide_debugger.py`).

The extension API is in `src/extensions/types.ts`. An extension can add:

- palette commands and panels;
- a bar under the tabs and editor features;
- language providers;
- a pre-save hook;
- open-file listeners, which is how linting reports into the Problems panel.

## Git

`git` in the Local terminal runs isomorphic-git in the Node supervisor.

| Topic | Details |
|---|---|
| **Commands** | `clone` (HTTPS, shallow, single branch), `init`, `status [-s]`, `add`, `rm`, `commit [-a] -m`, `log [--oneline]`, `diff --stat`, `branch`, `checkout [-b]`, `remote`, `push [-u]`, `pull`, `stash`, `tag`, `cherry-pick` and `rebase` with `--continue/--skip/--abort` |
| **Safety** | `checkout`, `pull`, `rm` and `stash` refuse to overwrite uncommitted work, and `pull` and `checkout` refuse during an unfinished merge, rebase or cherry-pick, as real git does (`git/tree.js`, `git/state.js`) |
| **Merging** | A line-level three-way merge (`git/merge3.js`). Conflicts are left as markers in the files. Blame and file history come from `git/blame.js` |
| **Not supported** | Interactive rebase, `--onto` and submodules. Use the real git in Remote mode |

Credentials:

- **Name, email and personal access token** are set under *Settings → Git*. They're kept in the Keychain and passed to each run as environment variables, never written into the project.
- **The token is sent only to github.com**, and never over plain HTTP (`git/auth.js`).
- **GitLab and Bitbucket** use their own signed-in accounts, each for its exact host.

## AI

AI features use the user's own key, with no Tide account in between:

- **Providers**: Anthropic, OpenAI, Google Gemini or OpenRouter, or a self-hosted Ollama or LM Studio server.
- **Where keys live**: in the Keychain.
- **Where requests go**: straight from the device to the provider.

| Feature | Where |
|---|---|
| Agent mode | Reads, edits and runs tests, asking before each command. Changes are staged for review as diffs and survive the app closing (`src/features/agent`) |
| Inline completions | Tab to accept, ⌥→ for one word (`src/features/editor/useInlineCompletions.ts`) |
| Fix with AI, Explain error | Previewed as a diff across files before anything changes |
| Suggest message | Commit messages from the staged change (`src/features/ai/commitMessage.ts`) |

Each AI job can use its own model. *Settings → AI assistant* shows this month's usage and cost, and has a monthly dollar limit, plus a token cap for models without a known price.

## Remote mode

Remote mode runs the project in a container on a [Tide server](#remote-server) you host. Set the server URL and token under *Settings → Remote server*; both are kept in the Keychain (Keystore on Android).

When a terminal switches to Remote, the app starts or reuses the project's container, uploads the project and opens a real bash shell in `/workspace`. Files then sync both ways.

| Topic | Behaviour |
|---|---|
| **Reconnecting** | Both sides are merged against the last version they agreed on. A file changed on one side takes that side's version. A file changed on both keeps the container's under its name, with the phone's next to it as `<name>.phone-conflict` |
| **Not synced** | `node_modules`, `.git`, `.pylibs`, `__pycache__`, `.venv`, `.next`, `.gradle` and similar folders at any depth; `venv`, `.cache`, `coverage` and `target` at the project root. Full list in `shared/protocol.ts` |
| **Container-owned** | Files over 2 MB and symlinks stay in the container; the phone never overwrites them |
| **Versioning** | App and server must speak the same `SyncProtocol` (`shared/protocol.ts`). The app refuses a mismatched server and says which side to update |
| **Previews** | When something listens on a port, a `:3000` button in the terminal header opens it in an in-app browser |
| **Transport** | URLs default to `https://`; Settings warns about plain `http://` outside your local network |

The simulator reaches a server on the same Mac at `localhost:8787`. On a phone, use the Mac's LAN address.

## Remote server

A small Node service that runs one Docker container per project. It needs Node 24 or newer, because it runs its TypeScript directly, and a Docker daemon.

```bash
cd server
npm install
npm run image                         # builds tide-session:dev (Node 24, Python 3, git, build tools)
TIDE_TOKEN=<at least 16 characters> npm start
```

| Variable | Default | Purpose |
|---|---|---|
| `TIDE_TOKEN` | required | Bearer token for every request |
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Listen address |
| `TIDE_IMAGE` | `tide-session:dev` | Container image |
| `TIDE_IDLE_MINUTES` | `15` | Remove a container this long after its last connection closes |
| `TIDE_MEMORY_MB`, `TIDE_CPUS`, `TIDE_PIDS` | `1024`, `1`, `512` | Per-container limits |

| Endpoint | Purpose |
|---|---|
| `GET /health` | No token. Returns `{ ok, protocol }` |
| `POST /sessions {"project"}` | Starts or reuses the project's container; reports the sync `protocol` |
| `DELETE /sessions/:id` | Removes the container |
| `WS /sessions/:id/pty` | bash |
| `WS /sessions/:id/sync` | Two-way file sync and listening ports |
| `GET /p/<previewKey>/<port>/` | Port preview. The random key stands in for the token, because a WebView can't send headers |

Containers run as a non-root user with no capabilities, no privileged mode, resource limits and no published ports. Leftover containers are removed when the server starts.

## Native features

- **Widget and deploy Live Activity**: `targets/widget` is a widget extension generated by `@bacons/apple-targets` at prebuild. `modules/tide-widgets` writes its data to the app group `group.com.thisiskurubaran.tide` and runs ActivityKit.
- **Siri and Shortcuts**: `native/ios/TideIntents.swift` (App Intents) is added to the app target by `plugins/withAppIntents.js`. The actions open `tide://` links, and links that run, deploy or send a request ask for confirmation first.
- **Apple Developer portal**: register the app group for both bundle IDs.
- **App icons**: icons and splash images are generated from `app/assets/brand/tide-mark.svg`, including the Midnight alternate icon. Run `npm run build:icons` after changing it.

## Privacy, crash reports and feedback

- **Crash reports** go to Sentry and stay off until the user turns on *Settings → Privacy → Send crash reports*.
  - **Opt-in builds only**: the setting only appears in builds made with `EXPO_PUBLIC_SENTRY_DSN`:
    ```bash
    EXPO_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project> npx expo start --dev-client
    ```
  - **What's left out**: reports carry no breadcrumbs, user or request data, screenshots or view hierarchy.
  - **Paths**: any path under Documents is replaced with `<documents>`.
  - **Source maps** aren't uploaded.
- **Help & feedback** in Settings has Report a problem, Suggest a feature, Rate Tide and What's new.
  - **Reports** open a mail draft with device details and recent warnings and errors attached; the user sees it before sending. `EXPO_PUBLIC_SUPPORT_EMAIL` overrides the address.
  - **Rating prompt**: shown at most once per version, after 5 runs and 3 days of use.
- **iOS privacy manifest** (`ios.privacyManifests` in `app.json`) declares crash data and the required-reason APIs. `usesNonExemptEncryption` is false.
- **Published policies**: the privacy policy and support page are at <https://thisiskurubaran.github.io/tide/privacy/> and <https://thisiskurubaran.github.io/tide/support/>.

## Generated bundles

Several third-party libraries are bundled into committed files, so rebuild them after upgrading:

| Command | Builds | Committed |
|---|---|---|
| `npm run build:web` | Editor and terminal WebViews → `src/features/<name>/<name>Html.generated.ts` | Yes |
| `npm run build:runtimes` | Ruby/PHP page → `assets/runtimes/runtime.html` | Yes |
| `npm run build:git` | isomorphic-git → `nodejs-project/git/isogit.js` | Yes |
| `npm run build:ssh` | ssh2 → `nodejs-project/ssh/ssh2.js`, with a stub poly1305; chacha20-poly1305 is off, since iOS nodejs-mobile has no WebAssembly | Yes |
| `npm run build:sql` | pg, mysql2 and the MongoDB driver → `nodejs-project/sql/drivers.js`, `mongo/driver.js` | Yes |
| `npm run build:lua` | fengari → `nodejs-project/lua/fengari.js` | Yes |
| `npm run build:services` | Prettier, ESLint and TypeScript workers | No, built at `npm install` |
| `npm run build:icons` | App icons and splash images | Yes |

All commands run from `app/`.

## Testing

| Suite | Command | Notes |
|---|---|---|
| App unit and component tests | `cd app && npm test` | Jest |
| Type check | `cd app && npx tsc --noEmit -p .` | |
| Server | `cd server && npm run typecheck && npm test` | `node:test`. The integration tests need Docker and the image from `npm run image` |
| Python runtime | `cd app/modules/python-runtime && python3 -m unittest discover -s tests` | Jedi tests are skipped unless jedi is on `PYTHONPATH` |
| Ruby/PHP runtime page | `cd app && npm run test:runtimes` | Runs the page in Chromium |
| Database drivers | `TIDE_TEST_POSTGRES`, `TIDE_TEST_MYSQL`, `TIDE_TEST_REDIS`, `TIDE_TEST_MONGO` | JSON connection settings; skipped when unset |
| End to end | `cd app && npm run e2e` | Maestro, against a Release build |

<details>
<summary><strong>Running the Maestro flows</strong></summary>

The flows in `app/.maestro` create a project, edit and run Node, run Python with input, and run in Remote mode. They start from a cleared app, which also clears a dev client's link to Metro, so run them against a Release build on a simulator.

```bash
brew install mobile-dev-inc/tap/maestro
export JAVA_HOME=/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
```

```bash
cd app/ios
xcodebuild -workspace Tide.xcworkspace -scheme Tide -configuration Release -sdk iphonesimulator build
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/Tide-*/Build/Products/Release-iphonesimulator/Tide.app
```

```bash
cd app
npm run e2e
maestro test -e TIDE_SERVER_URL=http://localhost:8787 -e TIDE_SERVER_TOKEN=<token> .maestro/remote-run.yaml
```

The flows read the terminal through xterm.js's screen reader mode, which also lets VoiceOver read terminal output.

</details>

## Releasing

1. Set `expo.version` in `app/app.json` and `version` in `app/package.json`, and add the release to `app/src/features/support/changelog.ts`. A test checks all three agree. What's new shows the entry once after an update; large releases can list `highlights`.
2. If `shared/protocol.ts` changed, bump `SyncProtocol` and ship the server with the app.
3. Build and submit with EAS. Build numbers are kept remotely and increase with each build.

```bash
cd app
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --profile production --platform ios
```

`preview` builds the same app for internal testers.

---

<div align="center">
<sub>Made by <a href="https://github.com/thisiskurubaran">Kurubaran Anandhan</a> · <a href="https://thisiskurubaran.github.io/tide/support/">Support</a> · <a href="https://thisiskurubaran.github.io/tide/privacy/">Privacy</a></sub>
</div>
