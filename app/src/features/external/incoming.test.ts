import { freeName, incomingFile } from './incoming';

describe('incoming files', () => {
  it('recognises files handed over by other apps', () => {
    expect(incomingFile('file:///private/var/mobile/Inbox/hello%20world.py')).toEqual({
      uri: 'file:///private/var/mobile/Inbox/hello%20world.py',
      name: 'hello world.py',
      kind: 'file',
    });
    expect(incomingFile('content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2FDownload%2Fsite.zip')?.kind).toBe('zip');
    expect(incomingFile('content://media/external/file/1234')?.name).toBe('1234');
  });

  it('leaves app links alone', () => {
    expect(incomingFile('tide://project/demo')).toBeNull();
    expect(incomingFile('/project/demo')).toBeNull();
  });

  it('finds a free name', () => {
    const taken = new Set(['a.txt', 'a (2).txt', 'Makefile']);
    expect(freeName('a.txt', (n) => taken.has(n))).toBe('a (3).txt');
    expect(freeName('Makefile', (n) => taken.has(n))).toBe('Makefile (2)');
    expect(freeName('b.txt', (n) => taken.has(n))).toBe('b.txt');
  });
});
