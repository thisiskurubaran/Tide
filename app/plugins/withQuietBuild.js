// Keeps the iOS build log down to warnings worth reading.
//
// Most of a Release build's warnings come from code Tide doesn't own: pods built
// from node_modules, React Native's prebuilt headers, and hermesc compiling the JS
// bundle. None of it can be fixed here, so this turns those off and leaves Tide's
// own code (the app and widget targets, app/modules/*) with every warning on.
//
// - Podfile post_install and post_integrate call plugins/quiet-build/quiet_build.rb:
//   no warnings for third-party pods, script phases without outputs marked as
//   run-every-build, and no "Update to recommended settings" prompt.
// - App target: Swift explicit modules off. Explicit module builds compile the
//   React, Expo and Sentry header modules as separate tasks under the app target,
//   with no way to quiet their header warnings. With implicit modules those
//   modules come from the pods' builds, where warnings are already off.
// - JS bundle: hermesc runs through plugins/quiet-build/hermesc.sh, which drops
//   only its "the variable X was not declared" warning for runtime globals.
const { withPodfile, withXcodeProject } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const BUNDLE_PHASE = 'Bundle React Native code and images';
const HERMES_MARKER = 'TIDE_HERMESC';
// 2.1.0 added this to the app target. Xcode's explicit module builds ignore it, so it
// hid nothing, and it can split clang module variants. Removed from existing projects.
const OLD_SWIFT_FLAGS = ' -Xcc -w';

const withQuietPods = (config) =>
  withPodfile(config, (cfg) => {
    const podfile = cfg.modResults;
    podfile.contents = mergeContents({
      tag: 'tide-quiet-build-require',
      src: podfile.contents,
      newSrc: "require File.join(__dir__, '..', 'plugins', 'quiet-build', 'quiet_build.rb')",
      anchor: /^require /m,
      offset: 0,
      comment: '#',
    }).contents;
    podfile.contents = mergeContents({
      tag: 'tide-quiet-build',
      src: podfile.contents,
      newSrc: '    tide_quiet_build(installer)',
      anchor: /post_install do \|installer\|/,
      offset: 1,
      comment: '#',
    }).contents;
    podfile.contents = mergeContents({
      tag: 'tide-quiet-build-integrate',
      src: podfile.contents,
      newSrc: ['  post_integrate do |installer|', '    tide_quiet_user_project(installer)', '  end', ''].join('\n'),
      anchor: /post_install do \|installer\|/,
      offset: 0,
      comment: '#',
    }).contents;
    return cfg;
  });

// pbxproj strings are quoted, with \" and \n escaped.
const pbxEscape = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const withQuietAppTarget = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;

    const targetKey = project.findTargetKey(cfg.modRequest.projectName ?? '');
    const target = targetKey && project.pbxNativeTargetSection()[targetKey];
    const list = target && project.pbxXCConfigurationList()[target.buildConfigurationList];
    const configs = project.pbxXCBuildConfigurationSection();
    for (const { value } of list?.buildConfigurations ?? []) {
      const settings = configs[value]?.buildSettings;
      if (!settings) continue;
      settings.SWIFT_ENABLE_EXPLICIT_MODULES = 'NO';
      const current = typeof settings.OTHER_SWIFT_FLAGS === 'string' ? settings.OTHER_SWIFT_FLAGS.replace(/^"|"$/g, '') : null;
      if (current?.includes(OLD_SWIFT_FLAGS)) settings.OTHER_SWIFT_FLAGS = `"${current.replace(OLD_SWIFT_FLAGS, '')}"`;
    }

    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const bundle = Object.values(phases).find(
      (phase) => typeof phase === 'object' && phase.name?.replace(/^"|"$/g, '') === BUNDLE_PHASE,
    );
    if (bundle && typeof bundle.shellScript === 'string' && !bundle.shellScript.includes(HERMES_MARKER)) {
      const lines = pbxEscape(
        [
          '',
          "# Tide: build the bundle without hermesc's \"variable was not declared\" warnings.",
          '# See plugins/quiet-build/hermesc.sh.',
          `export ${HERMES_MARKER}="\${HERMES_CLI_PATH:-$PODS_ROOT/hermes-engine/destroot/bin/hermesc}"`,
          'export HERMES_CLI_PATH="$PROJECT_DIR/../plugins/quiet-build/hermesc.sh"',
          '',
        ].join('\n'),
      );
      // After .xcode.env(.local) are sourced, so a HERMES_CLI_PATH set there is the one wrapped.
      const anchor = pbxEscape('source "$SRCROOT/.xcode.env.local"\nfi\n');
      if (bundle.shellScript.includes(anchor)) {
        bundle.shellScript = bundle.shellScript.replace(anchor, anchor + lines);
      } else {
        console.warn(`[withQuietBuild] "${BUNDLE_PHASE}" has changed; hermesc warnings are not filtered.`);
      }
    }
    return cfg;
  });

module.exports = (config) => withQuietAppTarget(withQuietPods(config));
