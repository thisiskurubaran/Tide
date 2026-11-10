import fs from 'fs';

const { loadChangelog, renderChangelog, TARGET } = require('../../../scripts/build-changelog.js');

describe('CHANGELOG.md', () => {
  it('matches the in-app changelog (run npm run build:changelog)', () => {
    expect(fs.readFileSync(TARGET, 'utf8')).toBe(renderChangelog(loadChangelog()));
  });
});
