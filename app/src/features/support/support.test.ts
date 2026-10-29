import { unseenReleases } from './changelog';
import { clearLogs, record, recentLogs } from './logs';
import { buildReport } from './report';
import { MIN_DAYS, MIN_RUNS, shouldAskForReview } from './review';

const DAY = 24 * 60 * 60 * 1000;
const info = { appVersion: '1.2.0', build: '7', platform: 'iOS', osVersion: '19.1', device: null, runtime: 'local' };

describe('logs and reports', () => {
  beforeEach(clearLogs);

  it('keeps the latest warnings and errors', () => {
    for (let i = 0; i < 250; i++) record('warn', [`w${i}`], i);
    record('error', [new Error('boom')], 999);
    expect(recentLogs()).toHaveLength(200);
    expect(recentLogs()[0].message).toBe('w51');
    expect(recentLogs()[199].message).toMatch(/^Error: boom/);
  });

  it('describes the device and hides sandbox paths', () => {
    record('warn', ['Could not open /var/mobile/Containers/Data/ABC/Documents/projects/a/x.js', { code: 2 }], 0);
    const report = buildReport(info, recentLogs(), '/var/mobile/Containers/Data/ABC/Documents');
    expect(report).toContain('Tide 1.2.0 (7)');
    expect(report).toContain('iOS 19.1');
    expect(report).toContain('WARN Could not open ~/projects/a/x.js {"code":2}');
    expect(report).not.toContain('Containers');
  });
});

describe('rating prompt', () => {
  const base = { installedAt: 0, runs: MIN_RUNS, askedVersion: null };
  it('waits for real use, then asks once per version', () => {
    expect(shouldAskForReview(base, '1.0.0', MIN_DAYS * DAY)).toBe(true);
    expect(shouldAskForReview({ ...base, runs: MIN_RUNS - 1 }, '1.0.0', 30 * DAY)).toBe(false);
    expect(shouldAskForReview(base, '1.0.0', DAY)).toBe(false);
    expect(shouldAskForReview({ ...base, askedVersion: '1.0.0' }, '1.0.0', 30 * DAY)).toBe(false);
    expect(shouldAskForReview({ ...base, askedVersion: '1.0.0' }, '1.1.0', 30 * DAY)).toBe(true);
  });
});

describe("what's new", () => {
  const log = [
    { version: '1.10.0', items: ['c'] },
    { version: '1.2.0', items: ['b'] },
    { version: '1.1.0', items: ['a'] },
  ];
  it('shows releases since the last one seen, not on first launch', () => {
    expect(unseenReleases(null, '1.10.0', log)).toEqual([]);
    expect(unseenReleases('1.10.0', '1.10.0', log)).toEqual([]);
    expect(unseenReleases('1.1.0', '1.10.0', log).map((r) => r.version)).toEqual(['1.10.0', '1.2.0']);
    expect(unseenReleases('1.1.0', '1.2.0', log).map((r) => r.version)).toEqual(['1.2.0']);
  });
});
