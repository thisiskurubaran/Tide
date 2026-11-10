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
// - App target: Swift explicit modules off, -Xcc -w and SWIFT_SUPPRESS_WARNINGS.
//   Swift reports warnings from the React, Expo and Sentry headers the app imports,
//   and from loading Expo's prebuilt swiftmodule ("broken by a context change"),
//   against the app target. -Xcc -w covers part of the headers; the rest only stop
//   with SWIFT_SUPPRESS_WARNINGS. Explicit module builds would compile the headers
//   in separate tasks that ignore both. The trade-off: warnings in the app target's
//   own Swift files (AppDelegate, SceneDelegate, TideIntents) are hidden too. The
//   widget target and Tide's modules (app/modules/*) still show every warning.
// - App target: the display name and app category as build settings, which is
//   where Xcode's General tab reads them. Info.plist already has both (app.json),
//   but without these the fields show empty after every prebuild.
// - JS bundle: hermesc runs through plugins/quiet-build/hermesc.sh, which drops
//   only its "the variable X was not declared" warning for runtime globals.
const { withPodfile, withXcodeProject } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

const BUNDLE_PHASE = 'Bundle React Native code and images';
const HERMES_MARKER = 'TIDE_HERMESC';
const APP_CATEGORY = 'public.app-category.developer-tools';
const SWIFT_FLAGS = '-Xcc -w';

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
      settings.SWIFT_SUPPRESS_WARNINGS = 'YES';
      settings.INFOPLIST_KEY_CFBundleDisplayName = JSON.stringify(cfg.name);
      settings.INFOPLIST_KEY_LSApplicationCategoryType = `"${APP_CATEGORY}"`;
      const current = String(settings.OTHER_SWIFT_FLAGS ?? '$(inherited)').replace(/^"|"$/g, '');
      if (!current.includes(SWIFT_FLAGS)) settings.OTHER_SWIFT_FLAGS = `"${current} ${SWIFT_FLAGS}"`;
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
