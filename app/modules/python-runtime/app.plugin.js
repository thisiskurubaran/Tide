const {
  withAppBuildGradle,
  withGradleProperties,
  withProjectBuildGradle,
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

module.exports = (config) => {
  config = withChaquopyClasspath(config);
  config = withAbiFilters(config);
  return config;
};
