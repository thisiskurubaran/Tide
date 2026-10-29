// Lets the in-app browser show servers that scripts start on the device
// (http://127.0.0.1:<port>), for the terminal's port previews.
//
// iOS: NSAllowsLocalNetworking (set in app.json) exempts local addresses from
// App Transport Security.
// Android: release builds allow plain HTTP to localhost only. Debug builds
// keep allowing it everywhere, which the development client needs to reach
// Metro on the LAN; src/debug overrides src/main for those builds.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RELEASE = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
`;

const DEBUG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

const withNetworkSecurityConfig = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return cfg;
  });

const withConfigFiles = (config) =>
  withDangerousMod(config, [
    'android',
    (cfg) => {
      const src = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src');
      for (const [variant, xml] of [
        ['main', RELEASE],
        ['debug', DEBUG],
      ]) {
        const dir = path.join(src, variant, 'res', 'xml');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'network_security_config.xml'), xml);
      }
      return cfg;
    },
  ]);

module.exports = (config) => withConfigFiles(withNetworkSecurityConfig(config));
