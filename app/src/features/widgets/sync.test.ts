import { activitySteps, sharedData } from './sync';

describe('widget data', () => {
  it('lists recent projects that still exist, newest first', () => {
    expect(JSON.parse(sharedData(true, ['a', 'b', 'c'], ['c', 'gone', 'a']))).toEqual({ pro: true, projects: ['a', 'b', 'c'], recent: ['c', 'a'] });
  });
});

describe('deploy Live Activity', () => {
  const deploying = { state: 'deploying' as const, message: 'Uploading', provider: 'netlify' };

  it('starts when a deploy starts, updates while it runs, and ends with the result', () => {
    expect(activitySteps({}, { site: deploying }, new Set())).toEqual([{ kind: 'start', project: 'site', provider: 'netlify', message: 'Uploading' }]);
    const live = new Set(['site']);
    expect(activitySteps({ site: deploying }, { site: { ...deploying, message: 'Uploading files (2/3)' } }, live)).toEqual([
      { kind: 'update', project: 'site', state: 'deploying', message: 'Uploading files (2/3)', url: null },
    ]);
    expect(activitySteps({ site: deploying }, { site: { state: 'done', message: 'Deployed', url: 'https://x.dev' } }, live)).toEqual([
      { kind: 'update', project: 'site', state: 'done', message: 'Deployed', url: 'https://x.dev' },
    ]);
  });

  it('leaves unchanged and cleared statuses alone', () => {
    const status = { site: deploying };
    expect(activitySteps(status, status, new Set(['site']))).toEqual([]);
    expect(activitySteps({ site: deploying }, { site: undefined }, new Set(['site']))).toEqual([]);
    // A result with no activity running (it was off, or not Pro) does nothing.
    expect(activitySteps({ site: deploying }, { site: { state: 'failed', message: 'x' } }, new Set())).toEqual([]);
  });
});
