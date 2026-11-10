// Writes CHANGELOG.md at the repo root from src/features/support/changelog.ts, the
// release notes the app shows in What's new. Run after adding a release:
//   npm run build:changelog
// A test (changelogFile.test.ts) fails when the two disagree.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SOURCE = path.join(__dirname, '..', 'src', 'features', 'support', 'changelog.ts');
const TARGET = path.join(__dirname, '..', '..', 'CHANGELOG.md');

function loadChangelog() {
  const js = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports.CHANGELOG;
}

function renderChangelog(releases) {
  const out = [
    '# Changelog',
    '',
    "All notable changes to Tide, newest first. The same notes appear in the app under Settings › What's new.",
    '',
    'Generated from [`app/src/features/support/changelog.ts`](app/src/features/support/changelog.ts) by `npm run build:changelog`; edit that file, not this one.',
    '',
  ];
  for (const release of releases) {
    out.push(`## ${release.version}`, '');
    if (release.highlights?.length) {
      out.push('### Highlights', '', ...release.highlights.map((h) => `- ${h}`), '', '### All changes', '');
    }
    out.push(...release.items.map((item) => `- ${item}`), '');
    if (release.developer?.length) {
      out.push('### Build and tooling', '', ...release.developer.map((item) => `- ${item}`), '');
    }
  }
  return out.join('\n');
}

module.exports = { loadChangelog, renderChangelog, TARGET };

if (require.main === module) {
  fs.writeFileSync(TARGET, renderChangelog(loadChangelog()));
  console.log(`wrote ${path.relative(process.cwd(), TARGET)}`);
}
