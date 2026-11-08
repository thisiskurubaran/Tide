// The widget extension: Recent projects, Quick actions, Last run and the Lock
// Screen widgets; the run, deploy, git, agent and package install Live
// Activities on the Lock Screen and in the Dynamic Island; and the Run
// project / Run tests controls (iOS 18) in Control Center.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  // Not "TideWidgets": that is the native module's pod, and a target with the
  // same name shadows its Swift module, so the app can't see TideWidgetsModule.
  name: 'TideWidget',
  bundleIdentifier: '.widget',
  displayName: 'Tide',
  // Matches the app's ios.deploymentTarget in app.json.
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit', 'AppIntents'],
  // Tide's palette, light and dark (TideTheme.swift reads these by name).
  // apple-targets 5 reads two-mode colors as { light, dark }; other keys
  // (e.g. { color, darkColor }) produce an empty colorset.
  colors: {
    $accent: { light: '#0f766e', dark: '#2dd4bf' },
    $widgetBackground: { light: '#f7fbfa', dark: '#0a1115' },
    TideBackground: { light: '#f7fbfa', dark: '#0a1115' },
    TideCard: { light: '#ffffff', dark: '#122027' },
    TideBorder: { light: '#d5e3e1', dark: '#1d3039' },
    TideForeground: { light: '#0b1f24', dark: '#eaf3f2' },
    TideMuted: { light: '#56706e', dark: '#93aaa9' },
    TideBrand: { light: '#0f766e', dark: '#2dd4bf' },
    TideSuccess: { light: '#15803d', dark: '#4ade80' },
    TideWarning: { light: '#b45309', dark: '#fbbf24' },
    TideDanger: { light: '#be123c', dark: '#fb7185' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
