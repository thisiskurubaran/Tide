// Adds the Siri and Shortcuts actions (native/ios/TideIntents.swift) to the
// app target. App Intents have to be compiled into the app itself for iOS to
// find them, so they can't live in a pod.
const fs = require('fs');
const path = require('path');
const { IOSConfig, withXcodeProject } = require('expo/config-plugins');

const FILE = 'TideIntents.swift';

module.exports = function withAppIntents(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const name = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'native', 'ios', FILE), path.join(cfg.modRequest.platformProjectRoot, name, FILE));
    const filepath = `${name}/${FILE}`;
    if (!project.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: name, project });
    }
    return cfg;
  });
};
