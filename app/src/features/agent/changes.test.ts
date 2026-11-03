import { ChangeConflictError, changeHunks, countLines, diffStats } from './changes';
import { memoryProject } from './testUtils';

const P = 'demo';
const lines = (n: number, edit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => `${edit[i + 1] ?? `line ${i + 1}`}\n`).join('');

// Two changes far enough apart to be separate hunks.
const before = lines(20);
const after = lines(20, { 2: 'TWO', 18: 'EIGHTEEN' });

function staged() {
  const p = memoryProject({ 'a.txt': before });
  p.changes.getState().stage(P, 'a.txt', before, after);
  return p;
}

const change = (p: ReturnType<typeof memoryProject>, path = 'a.txt') => p.changes.getState().byProject[P]?.[path];

describe('pending changes', () => {
  it('stages without touching disk and splits into hunks', () => {
    const p = staged();
    expect(p.writes).toEqual([]);
    const c = change(p)!;
    expect(c.original).toBe(before);
    const hunks = changeHunks(c);
    expect(hunks).toHaveLength(2);
    expect(countLines(hunks)).toEqual({ added: 2, removed: 2 });
  });

  it('keeps the first edit original when the agent edits again', () => {
    const p = staged();
    const again = lines(20, { 2: 'TWO', 18: 'EIGHTEEN', 10: 'TEN' });
    p.changes.getState().stage(P, 'a.txt', 'ignored', again);
    expect(change(p)!.original).toBe(before);
    expect(changeHunks(change(p)!)).toHaveLength(3);
  });

  it('drops a change that is edited back to the original', () => {
    const p = staged();
    p.changes.getState().stage(P, 'a.txt', null, before);
    expect(change(p)).toBeUndefined();
  });

  it('keeps one hunk: written to disk, the other still pending', async () => {
    const p = staged();
    await p.changes.getState().keepHunk(P, 'a.txt', 0);
    expect(p.disk.get('a.txt')).toBe(lines(20, { 2: 'TWO' }));
    const c = change(p)!;
    expect(changeHunks(c)).toHaveLength(1);
    expect(c.proposed).toBe(after);
    // Then the other: resolved, history recorded once with the final text.
    await p.changes.getState().keepHunk(P, 'a.txt', 0);
    expect(change(p)).toBeUndefined();
    expect(p.disk.get('a.txt')).toBe(after);
    expect(p.history).toEqual([['a.txt', after, before]]);
  });

  it('rejects one hunk: disk untouched, the proposal loses that hunk', async () => {
    const p = staged();
    await p.changes.getState().rejectHunk(P, 'a.txt', 1);
    expect(p.writes).toEqual([]);
    expect(change(p)!.proposed).toBe(lines(20, { 2: 'TWO' }));
    await p.changes.getState().rejectHunk(P, 'a.txt', 0);
    expect(change(p)).toBeUndefined();
    expect(p.disk.get('a.txt')).toBe(before);
    expect(p.history).toEqual([]);
  });

  it('keeps and rejects whole files', async () => {
    const p = memoryProject({ 'a.txt': 'a\n', 'b.txt': 'b\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.changes.getState().stage(P, 'b.txt', 'b\n', 'B\n');
    await p.changes.getState().keepFile(P, 'a.txt');
    await p.changes.getState().rejectFile(P, 'b.txt');
    expect(p.disk.get('a.txt')).toBe('A\n');
    expect(p.disk.get('b.txt')).toBe('b\n');
    expect(p.changes.getState().byProject[P]).toEqual({});
  });

  it('creates new files on keep and never writes rejected ones', async () => {
    const p = memoryProject();
    p.changes.getState().stage(P, 'src/new.js', null, 'x\n');
    p.changes.getState().stage(P, 'other.js', null, 'y\n');
    expect(changeHunks(change(p, 'src/new.js')!)).toHaveLength(1);
    await p.changes.getState().keepHunk(P, 'src/new.js', 0);
    await p.changes.getState().rejectHunk(P, 'other.js', 0);
    expect(p.disk.get('src/new.js')).toBe('x\n');
    expect(p.disk.has('other.js')).toBe(false);
    expect(p.writes).toEqual([['src/new.js', 'x\n']]);
  });

  it('keep all and undo all', async () => {
    const p = memoryProject({ 'a.txt': 'a\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.changes.getState().stage(P, 'n.txt', null, 'n\n');
    await p.changes.getState().keepAll(P);
    expect(Object.fromEntries(p.disk)).toEqual({ 'a.txt': 'A\n', 'n.txt': 'n\n' });

    const q = memoryProject({ 'a.txt': 'a\n' });
    q.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    q.changes.getState().stage(P, 'n.txt', null, 'n\n');
    await q.changes.getState().undoAll(P);
    expect(Object.fromEntries(q.disk)).toEqual({ 'a.txt': 'a\n' });
    expect(q.writes).toEqual([]);
  });

  describe('applied for a command', () => {
    it('writes proposals to disk, and rejecting restores the original', async () => {
      const p = memoryProject({ 'a.txt': before });
      p.changes.getState().stage(P, 'a.txt', before, after);
      p.changes.getState().stage(P, 'n.txt', null, 'new\n');
      await p.changes.getState().applyToDisk(P);
      expect(p.disk.get('a.txt')).toBe(after);
      expect(p.disk.get('n.txt')).toBe('new\n');
      // Still pending review.
      expect(Object.keys(p.changes.getState().byProject[P])).toHaveLength(2);

      // Rejecting one hunk takes it off disk; the other stays applied.
      await p.changes.getState().rejectHunk(P, 'a.txt', 0);
      expect(p.disk.get('a.txt')).toBe(lines(20, { 18: 'EIGHTEEN' }));
      await p.changes.getState().rejectFile(P, 'a.txt');
      await p.changes.getState().rejectFile(P, 'n.txt');
      expect(p.disk.get('a.txt')).toBe(before);
      expect(p.disk.has('n.txt')).toBe(false);
    });

    it('keeping an applied change needs no write', async () => {
      const p = memoryProject({ 'a.txt': 'a\n' });
      p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
      await p.changes.getState().applyToDisk(P);
      p.writes.length = 0;
      await p.changes.getState().keepAll(P);
      expect(p.writes).toEqual([]);
      expect(p.history).toEqual([['a.txt', 'A\n', 'a\n']]);
    });

    it('picks up what a program wrote to a changed file', async () => {
      const p = memoryProject({ 'a.txt': 'a\n' });
      p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
      await p.changes.getState().applyToDisk(P);
      p.disk.set('a.txt', 'A formatted\n');
      await p.changes.getState().syncFromDisk(P);
      expect(change(p)!.proposed).toBe('A formatted\n');
      await p.changes.getState().rejectFile(P, 'a.txt');
      expect(p.disk.get('a.txt')).toBe('a\n');
    });
  });

  it('refuses to overwrite a file changed behind its back unless forced', async () => {
    const p = memoryProject({ 'a.txt': 'a\n' });
    p.changes.getState().stage(P, 'a.txt', 'a\n', 'A\n');
    p.disk.set('a.txt', 'user edit\n');
    await expect(p.changes.getState().keepFile(P, 'a.txt')).rejects.toBeInstanceOf(ChangeConflictError);
    expect(change(p)).toBeDefined();
    await p.changes.getState().keepFile(P, 'a.txt', true);
    expect(p.disk.get('a.txt')).toBe('A\n');
  });

  it('counts +/− between two texts', () => {
    expect(diffStats('a\nb\n', 'a\nB\nc\n')).toEqual({ added: 2, removed: 1 });
    expect(diffStats(null, 'x\ny\n')).toEqual({ added: 2, removed: 0 });
  });
});
