import { commandInput, moveCommand, upsertCommand } from './commands';

describe('saved SSH commands', () => {
  it('types commands with a return, one line at a time', () => {
    expect(commandInput({ name: 'x', command: 'df -h' })).toBe('df -h\r');
    expect(commandInput({ name: 'x', command: 'cd /srv\nls\n' })).toBe('cd /srv\rls\r');
  });

  it('adds, edits and reorders commands, and needs a name and a command', () => {
    let list = upsertCommand([], null, { name: ' Logs ', command: ' tail -f app.log ' });
    list = upsertCommand(list, null, { name: 'Restart', command: 'sudo systemctl restart app' });
    expect(list).toEqual([
      { name: 'Logs', command: 'tail -f app.log' },
      { name: 'Restart', command: 'sudo systemctl restart app' },
    ]);
    list = upsertCommand(list, 0, { name: 'Logs', command: 'tail -n 100 -f app.log' });
    expect(list[0].command).toBe('tail -n 100 -f app.log');
    expect(moveCommand(list, 1, -1).map((c) => c.name)).toEqual(['Restart', 'Logs']);
    expect(moveCommand(list, 0, -1)).toBe(list);
    expect(() => upsertCommand(list, null, { name: '', command: 'ls' })).toThrow(/name/);
  });
});
