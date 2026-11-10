// Jest: glass is a plain View; available so the glass path renders in tests.
const React = require('react');
const { View } = require('react-native');

const GlassView = ({ glassEffectStyle, tintColor, isInteractive, colorScheme, ...props }) => React.createElement(View, props);
const GlassContainer = ({ spacing, ...props }) => React.createElement(View, props);

module.exports = {
  GlassView,
  GlassContainer,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
};
