import { createRemoteBusyTracker, createRunningRegistry } from './running';

describe('running registry', () => {
  it('is running while any key is on, and tells listeners when that changes', () => {
    const r = createRunningRegistry();
    const seen: boolean[] = [];
    const off = r.subscribe((on) => seen.push(on));
    r.set('a', true);
    r.set('b', true);
    r.set('a', false);
    expect(r.isRunning()).toBe(true);
    r.set('b', false);
    r.set('unknown', false);
    expect(r.isRunning()).toBe(false);
    expect(seen).toEqual([true, false]);
    off();
    r.set('a', true);
    expect(seen).toEqual([true, false]);
  });
});

describe('remote busy tracker', () => {
  const setup = () => {
    const changes: boolean[] = [];
    const t = createRemoteBusyTracker((b) => changes.push(b));
    return { t, changes };
  };

  it('is busy from Enter until a prompt comes back', () => {
    const { t, changes } = setup();
    t.input('npm run dev');
    expect(t.busy).toBe(false);
    t.input('\r');
    expect(t.busy).toBe(true);
    t.output('\r\n> app@1.0.0 dev\r\n> vite\r\n\r\n  VITE ready in 300 ms\r\n  ➜  Local: http://localhost:5173/\r\n');
    expect(t.busy).toBe(true);
    t.output('^C\r\n\x1b[01;32muser@box\x1b[00m:\x1b[01;34m~/app\x1b[00m$ ');
    expect(t.busy).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('notices a prompt split across chunks, and a root prompt', () => {
    const { t } = setup();
    t.input('make\r');
    t.output('done\r\nroot@box:/app');
    expect(t.busy).toBe(true);
    t.output('# ');
    expect(t.busy).toBe(false);
  });

  it('ignores output while idle, and ends when the shell closes or the pane goes', () => {
    const { t, changes } = setup();
    t.output('user@box:~$ ');
    expect(changes).toEqual([]);
    t.input('sleep 100\r');
    t.output('\r\n\x1b[2mRemote shell closed: bye. Switch modes or reopen the project to reconnect.\x1b[0m\r\n');
    expect(t.busy).toBe(false);
    t.input('\r');
    t.end();
    expect(changes).toEqual([true, false, true, false]);
  });
});
