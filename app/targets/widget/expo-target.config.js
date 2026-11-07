// The widget extension: Recent Projects on the Home Screen, the deploy and run
// Live Activities on the Lock Screen and in the Dynamic Island, and the Run
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
  colors: {
    $accent: '#2dd4bf',
    // apple-targets 5 reads two-mode colors as { light, dark }; other keys
    // (e.g. { color, darkColor }) produce an empty colorset.
    $widgetBackground: { light: '#ffffff', dark: '#0a1115' },
    // The same, under a plain name for the Swift code.
    TideBackground: { light: '#ffffff', dark: '#0a1115' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
