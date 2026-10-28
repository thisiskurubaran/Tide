// nodejs-mobile's "Build/Sign Native Modules" phases refuse to run unless the
// host Node is exactly 18, even with BUILD_NATIVE_MODULES.txt set to 0. Local
// mode only supports pure-JS packages, so keep just the copy and strip phases.
const path = require('path');

const scripts = path.join(path.dirname(require.resolve('nodejs-mobile-react-native/package.json')), 'scripts');

module.exports = {
  dependencies: {
    'nodejs-mobile-react-native': {
      platforms: {
        ios: {
          scriptPhases: [
            {
              name: '[NODEJS MOBILE] Copy Node.js Project files',
              path: path.join(scripts, 'ios-copy-nodejs-project.sh'),
              execution_position: 'after_compile',
            },
            {
              name: '[NODEJS MOBILE] Remove Simulator Strip',
              path: path.join(scripts, 'ios-remove-framework-simulator-strips.sh'),
              execution_position: 'after_compile',
            },
          ],
        },
      },
    },
  },
};
