import { lastLines, repoName } from './runGit';

describe('git helpers', () => {
  it('names a project after the repository', () => {
    expect(repoName('https://github.com/octocat/Hello-World.git')).toBe('Hello-World');
    expect(repoName('https://gitlab.com/a/b/')).toBe('b');
    expect(repoName('git@github.com:a/c.git')).toBe('c');
  });

  it('keeps only what progress redraws leave on screen', () => {
    expect(lastLines('Cloning\nrecv: 10%\r\x1b[Krecv: 100%\ndone\n')).toBe('Cloning\nrecv: 100%\ndone');
  });
});
