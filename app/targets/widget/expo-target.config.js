// The widget extension: Recent Projects on the Home Screen, and the deploy
// Live Activity on the Lock Screen and in the Dynamic Island.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  // Not "TideWidgets": that is the native module's pod, and a target with the
  // same name shadows its Swift module, so the app can't see TideWidgetsModule.
  name: 'TideWidget',
  bundleIdentifier: '.widget',
  displayName: 'Tide',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: '#7c8cff',
    // apple-targets 5 reads two-mode colors as { light, dark }; other keys
    // (e.g. { color, darkColor }) produce an empty colorset.
    $widgetBackground: { light: '#ffffff', dark: '#0d0f0e' },
    // The same, under a plain name for the Swift code.
    TideBackground: { light: '#ffffff', dark: '#0d0f0e' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
