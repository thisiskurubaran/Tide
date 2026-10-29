const {
  withAppBuildGradle,
  withGradleProperties,
  withProjectBuildGradle,
  withXcodeProject,
} = require('expo/config-plugins');

const CHAQUOPY_VERSION = '17.2.0';
// Python 3.13+ on Chaquopy is 64-bit only, and nodejs-mobile follows the app's
// abiFilters, so both runtimes and React Native must agree on this list.
const ABIS = ['arm64-v8a', 'x86_64'];

const withChaquopyClasspath = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    const line = `classpath('com.chaquo.python:gradle:${CHAQUOPY_VERSION}')`;
    if (!cfg.modResults.contents.includes('com.chaquo.python:gradle')) {
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n    ${line}`,
      );
    }
    return cfg;
  });

const withAbiFilters = (config) => {
  config = withGradleProperties(config, (cfg) => {
    const props = cfg.modResults.filter(
      (p) => !(p.type === 'property' && p.key === 'reactNativeArchitectures'),
    );
    props.push({ type: 'property', key: 'reactNativeArchitectures', value: ABIS.join(',') });
    cfg.modResults = props;
    return cfg;
  });
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes('abiFilters')) {
      const filters = ABIS.map((a) => `"${a}"`).join(', ');
      cfg.modResults.contents = cfg.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (match) => `${match}\n        ndk { abiFilters ${filters} }`,
      );
    }
    return cfg;
  });
};

const IOS_PHASE_NAME = '[Tide] Install Python';
// Paths are relative to app/ios, which is $PROJECT_DIR for the app target.
const IOS_PHASE_SCRIPT = [
  'set -e',
  'XCFW=../modules/python-runtime/ios/Python.xcframework',
  'source "$PROJECT_DIR/$XCFW/build/utils.sh"',
  'install_python "$XCFW"',
  'mkdir -p "$CODESIGNING_FOLDER_PATH/python/tide"',
  // Packages too: Format & Lint's pyflakes is a folder.
  'rsync -a --exclude __pycache__ --exclude ".*" "$PROJECT_DIR/../modules/python-runtime/python/" "$CODESIGNING_FOLDER_PATH/python/tide/"',
].join('\\n');

// The XCframework only holds libpython. The stdlib and the extension modules
// (converted to frameworks, as iOS requires) are copied into the app here.
const withPythonInstallPhase = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
    const exists = Object.values(phases).some(
      (phase) => typeof phase === 'object' && phase.name === `"${IOS_PHASE_NAME}"`,
    );
    if (!exists) {
      project.addBuildPhase([], 'PBXShellScriptBuildPhase', IOS_PHASE_NAME, project.getFirstTarget().uuid, {
        shellPath: '/bin/sh',
        shellScript: IOS_PHASE_SCRIPT,
      });
    }
    return cfg;
  });

module.exports = (config) => {
  config = withChaquopyClasspath(config);
  config = withAbiFilters(config);
  config = withPythonInstallPhase(config);
  return config;
};
