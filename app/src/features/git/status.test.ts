import { changeLetter, createGitStatusStore, parseStatus } from './status';

describe('git status', () => {
  it('parses porcelain output and the current branch', () => {
    const s = parseStatus(' M src/a.ts\n?? notes.md\nR  old.js -> new.js\n', '  dev\n* main\n');
    expect(s.branch).toBe('main');
    expect(s.changes).toEqual({ 'src/a.ts': ' M', 'notes.md': '??', 'new.js': 'R ' });
  });

  it('maps codes to tree letters', () => {
    expect(changeLetter(' M')).toBe('M');
    expect(changeLetter('??')).toBe('U');
    expect(changeLetter('A ')).toBe('U');
    expect(changeLetter(' D')).toBe('D');
    expect(changeLetter(undefined)).toBeNull();
  });

  it('stores null outside a repository and shares a refresh in flight', async () => {
    const run = jest.fn(async (_p: string, args: string[]) => (args[0] === 'status' ? { code: 128, stdout: '' } : { code: 0, stdout: '' }));
    const store = createGitStatusStore(run);
    await Promise.all([store.getState().refresh('p'), store.getState().refresh('p')]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(store.getState().byProject.p).toBeNull();
  });
});

it('has no branch before the first commit or on a detached HEAD', () => {
  expect(parseStatus('?? a.txt\n', '').branch).toBeNull();
  expect(parseStatus('', '* (HEAD detached at 1a2b3c)\n').branch).toBeNull();
});
