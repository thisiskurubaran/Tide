import { runLine } from './run';

describe('runLine', () => {
  it('uses the local shell run built-in', () => {
    expect(runLine('local', null)).toBe('run\r');
  });

  it('spells out the entry for the remote shell', () => {
    expect(runLine('remote', '{"runtime":"python","entry":"main.py"}')).toBe('python3 main.py\r');
    expect(runLine('remote', '{"runtime":"node","entry":"src/index.js"}')).toBe('node src/index.js\r');
    expect(runLine('remote', '{"entry":"my app.js"}')).toBe("node 'my app.js'\r");
    expect(runLine('remote', '{}')).toBeNull();
    expect(runLine('remote', 'not json')).toBeNull();
  });
});
