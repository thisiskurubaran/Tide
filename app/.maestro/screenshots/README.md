# 2.1.0 review screenshots

Screenshots of the iOS changes in 2.1.0 (issues #14 to #23), to check before the issues are closed. Maestro takes the in-app ones; the widgets, Live Activities, app icon and VoiceOver need a few by hand, because Maestro can't drive the Home Screen or Lock Screen.

## 1. Build and install

Use an **iOS 26** simulator (an iPhone, for example iPhone 17 Pro), so the Liquid Glass parts show. Build a Release build and install it, as in the README's "Running the Maestro flows":

```bash
cd app
npx expo prebuild --platform ios --clean
cd ios
xcodebuild -workspace Tide.xcworkspace -scheme Tide -configuration Release -sdk iphonesimulator build
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/Tide-*/Build/Products/Release-iphonesimulator/Tide.app
```

## 2. Automatic screenshots

```bash
cd app
npm run screenshots
```

This runs the flows in this folder twice, at the default text size and at the largest accessibility size (it sets the simulator's text size and puts it back afterwards). The PNGs land in `app/screenshots-2.1.0/`, which git ignores. Each file starts with `default-` or `ax-xxxl-`:

| File | Shows | Issue |
|---|---|---|
| `01-project-activity-bar` | Glass activity bar, its labels, SF Symbols | #16, #19, #23 |
| `02-terminal-tabs` | Two terminal tabs, each with its own close button | #15 |
| `03-git-tools-rows` | Stage and Discard beside a file row (or `03-source-control-sheet` if Git Tools is off) | #15, #16 |
| `04-command-palette` | Section headers at 11pt or more | #19 |
| `05-projects-list` | Project badges at 11pt or more, SF Symbols | #19, #23 |
| `06-action-sheet` | Long-press menu as a native sheet | #16 |
| `07-prompt-sheet-keyboard` | Rename, opened from the menu, above the keyboard | #16 |
| `08-after-swipe-down` | The list again after swiping the sheet away | #16 |
| `09-whats-new-sheet` | A scrolling native sheet, with the 2.1.0 notes | #16 |
| `10-ai-key-field` | No Passwords suggestion above the keyboard | #22 |
| `11-remote-token-field` | No SMS code suggestion above the keyboard | #22 |

If a step fails, the shots before it are still saved and the script carries on with the next run.

## 3. Screenshots by hand

On the same simulator unless noted. On the simulator, File › Save Screen (⌘S) saves a screenshot to the Desktop.

**App icon (#23)**
- [ ] Home Screen with the default look
- [ ] Dark: long-press the Home Screen › Edit › Customize › Dark
- [ ] Tinted: same menu › Tinted
- [ ] Clear: same menu › Clear (iOS 26)
- [ ] Settings › App icon in Tide: Midnight still works

**Widgets (#14, #18, #21)**: add each from the Home Screen's Edit › Add Widget › Tide
- [ ] Recent Projects, small and medium
- [ ] Quick actions, before creating any project (Run tile says "No project yet") and after
- [ ] Last run, after running `run` in a project
- [ ] Lock Screen: the circular and rectangular widgets (Lock Screen › Customize)
- [ ] All of the above again with Settings › Accessibility › Display & Text Size › Larger Text at the largest size
- [ ] Tap the circular Lock Screen widget: Tide opens the project with the terminal showing and **nothing runs**

**Live Activities (#14, #20)**
- [ ] Run `run` in a project, lock the simulator: the Lock Screen activity with its Stop button
- [ ] Dynamic Island, compact and expanded (long-press it), on an iPhone with the Dynamic Island
- [ ] The same at the largest text size

**Run Last Again (#18)**
- [ ] Shortcuts app › Tide: "Run Last Again" is listed with its icon; running it asks before running

**VoiceOver (#15)**: on a device if you can; on the simulator use Accessibility Inspector (Xcode › Open Developer Tool)
- [ ] Git Tools: Stage and Discard can be focused on their own, not just the whole row
- [ ] Terminal tab: "Close terminal 1" can be focused on its own
- [ ] GitHub repo screen: Re-run on a workflow row; Hosts: the account's More button
- [ ] Dynamic Island icons are read as "Running, …", "Tests failed, …" and so on, not symbol names

**Swipe-back (#17)**: video is best (simulator: File › Record Screen)
- [ ] From a project, swiping from the very left edge goes back to the project list
- [ ] Swiping from a little further in opens the file drawer; the Files button opens it too

**Glass and contrast (#16)**
- [ ] `01-project-activity-bar` again with Settings › Accessibility › Display & Text Size › Reduce Transparency on: solid bar, no glass
- [ ] A sheet over the editor and one over the terminal in dark mode, to check readability
- [ ] Optional: the same screen on an iOS 18 simulator, to see the fallback look
