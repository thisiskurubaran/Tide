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
  // install_python copies lib-$ARCHS, which only exists for one architecture. A Release
  // build for the simulator has two (arm64 x86_64), so run it with the first and copy
  // the other slices' lib folders (they only hold per-architecture sysconfig data).
  'ALL_ARCHS="$ARCHS"',
  'ARCHS="${ALL_ARCHS%% *}"',
  'install_python "$XCFW"',
  'case "$ALL_ARCHS" in *" "*) for A in $ALL_ARCHS; do rsync -au "$PROJECT_DIR/$XCFW/ios-arm64_x86_64-simulator/lib-$A/" "$CODESIGNING_FOLDER_PATH/python/lib/" --exclude "libpython*.dylib"; done ;; esac',
  'ARCHS="$ALL_ARCHS"',
  'mkdir -p "$CODESIGNING_FOLDER_PATH/python/tide"',
  // Packages too: Format & Lint's pyflakes is a folder.
  'rsync -a --exclude __pycache__ --exclude ".*" "$PROJECT_DIR/../modules/python-runtime/python/" "$CODESIGNING_FOLDER_PATH/python/tide/"',
  // Size: Tide never runs Python with -O, so the optimized .pyc copies are never read.
  // There is no Tk on iOS, Tide has its own pip, and CPython's test modules are for its own suite.
  'LIB="$CODESIGNING_FOLDER_PATH/python/lib"',
  'find "$LIB" -name "*.opt-1.pyc" -delete -o -name "*.opt-2.pyc" -delete',
  'rm -rf "$LIB"/python3.*/tkinter "$LIB"/python3.*/turtledemo "$LIB"/python3.*/ensurepip',
  'rm -rf "$CODESIGNING_FOLDER_PATH"/Frameworks/_test*.framework "$CODESIGNING_FOLDER_PATH"/Frameworks/_xxtestfuzz.framework "$CODESIGNING_FOLDER_PATH"/Frameworks/_ctypes_test.framework',
  'rm -f "$LIB"/python3.*/lib-dynload/_test*.fwork "$LIB"/python3.*/lib-dynload/_xxtestfuzz.*.fwork "$LIB"/python3.*/lib-dynload/_ctypes_test.*.fwork',
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
      const { buildPhase } = project.addBuildPhase([], 'PBXShellScriptBuildPhase', IOS_PHASE_NAME, project.getFirstTarget().uuid, {
        shellPath: '/bin/sh',
        shellScript: IOS_PHASE_SCRIPT,
      });
      // The copy has to run on every build (Python files change without Xcode knowing),
      // so say so: without this Xcode warns that the phase has no outputs.
      buildPhase.alwaysOutOfDate = 1;
    }
    return cfg;
  });

module.exports = (config) => {
  config = withChaquopyClasspath(config);
  config = withAbiFilters(config);
  config = withPythonInstallPhase(config);
  return config;
};
