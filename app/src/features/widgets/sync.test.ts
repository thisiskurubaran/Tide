import { activitySteps, projectLanguage, sharedData, spotlightItems, widgetData } from './sync';

describe('widget data', () => {
  it('lists recent projects that still exist, newest first', () => {
    const data = JSON.parse(sharedData(['a', 'b', 'c'], ['c', 'gone', 'a']));
    expect(data.projects).toEqual(['a', 'b', 'c']);
    expect(data.recent).toEqual(['c', 'a']);
    // The cards: recent first, then the rest.
    expect(data.cards.map((c: { name: string }) => c.name)).toEqual(['c', 'a', 'b']);
    expect(data.files).toEqual([]);
    expect(data.lastRun).toBeNull();
  });

  it('describes each card with its language, branch, changes and when it was opened', () => {
    const data = widgetData({
      projects: ['site', 'cli', 'fresh'],
      recent: ['site'],
      openedAt: { site: 2000, cli: 1000 },
      languages: { site: { name: 'TS', badge: 'TS', color: '#6f9dff' }, cli: null },
      git: { site: { branch: 'main', changes: 3 }, cli: { branch: null, changes: 0 } },
    });
    expect(data.cards).toEqual([
      { name: 'site', language: 'TS', badge: 'TS', color: '#6f9dff', branch: 'main', changes: 3, openedAt: 2000 },
      // Opened before, though not in the short recent list: by last opened.
      { name: 'cli', changes: 0, openedAt: 1000 },
      // Never opened, no language yet, not a repository: just the name.
      { name: 'fresh' },
    ]);
  });

  it('keeps at most six cards and six files, and drops ones for deleted projects', () => {
    const projects = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const files = [{ project: 'gone', path: 'a.ts', at: 9 }, ...projects.map((p, i) => ({ project: p, path: 'index.ts', at: i }))];
    const data = widgetData({ projects, recent: [], files });
    expect(data.cards).toHaveLength(6);
    expect(data.files).toHaveLength(6);
    expect(data.files[0].project).toBe('p1');
  });

  it('shares the last run only while its project exists', () => {
    const lastRun = { project: 'site', command: 'npm test', kind: 'tests' as const, status: 'passed' as const, detail: 'All 3 passed', exitCode: 0, startedAt: 1, endedAt: 5 };
    expect(widgetData({ projects: ['site'], recent: [], lastRun }).lastRun).toEqual(lastRun);
    expect(widgetData({ projects: ['other'], recent: [], lastRun }).lastRun).toBeNull();
  });

  it('reads a project language from the home screen summary', () => {
    expect(projectLanguage({ badge: { text: 'Py', color: '#3fc095' }, languages: ['Python', 'Markdown'] })).toEqual({ name: 'Python', badge: 'Py', color: '#3fc095' });
    expect(projectLanguage({ badge: null, languages: [] })).toBeNull();
    expect(projectLanguage(undefined)).toBeNull();
  });
});

describe('Spotlight items', () => {
  it('has each project with its language and last opened time where known', () => {
    expect(spotlightItems(['a', 'b'], { a: { name: 'TS', badge: 'TS', color: '#fff' } }, { b: 42 })).toEqual([
      { name: 'a', language: 'TS' },
      { name: 'b', openedAt: 42 },
    ]);
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
