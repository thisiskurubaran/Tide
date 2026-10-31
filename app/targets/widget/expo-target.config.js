// The widget extension: Recent Projects on the Home Screen, and the deploy
// Live Activity on the Lock Screen and in the Dynamic Island (Tide Pro).
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'TideWidgets',
  displayName: 'Tide',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: '#7c8cff',
    $widgetBackground: { color: '#ffffff', darkColor: '#0d0f0e' },
    // The same, under a plain name for the Swift code.
    TideBackground: { color: '#ffffff', darkColor: '#0d0f0e' },
  },
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
