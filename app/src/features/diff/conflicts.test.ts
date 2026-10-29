import { splitConflicts } from './conflicts';

describe('splitConflicts', () => {
  it('splits a file into both sides of its conflicts', () => {
    const text = 'a\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feature\nb\n<<<<<<< HEAD\nx\n||||||| base\nbase\n=======\ny\n>>>>>>> feature\n';
    expect(splitConflicts(text)).toEqual({ ours: 'a\nours\nb\nx\n', theirs: 'a\ntheirs\nb\ny\n', count: 2, oursLabel: 'HEAD', theirsLabel: 'feature' });
  });

  it('ignores files without, or with broken, markers', () => {
    expect(splitConflicts('plain\n')).toBeNull();
    expect(splitConflicts('<<<<<<< a\nx\n=======\ny\n')).toBeNull();
  });
});
