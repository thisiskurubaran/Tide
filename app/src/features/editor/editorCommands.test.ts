import { editorCommands } from './editorCommands';

describe('editorCommands', () => {
  it('sends line, Markdown and image commands to the editor', () => {
    const send = jest.fn();
    const commands = editorCommands({ current: { send } }, true);
    const run = (id: string) => commands.find((c) => c.id === id)!.run();
    run('lines.sortAsc');
    run('lines.duplicate');
    run('copy-markdown');
    run('share-image');
    run('share-image.plain');
    expect(send.mock.calls.map(([m]) => m)).toEqual([
      { type: 'lines', command: 'sortAsc' },
      { type: 'lines', command: 'duplicate' },
      { type: 'copyMarkdown' },
      { type: 'shareImage', lineNumbers: true },
      { type: 'shareImage', lineNumbers: false },
    ]);
    expect(commands.map((c) => c.title)).toEqual(
      expect.arrayContaining(['Sort lines ascending', 'Sort lines descending', 'Reverse lines', 'Join lines', 'Duplicate line or selection', 'Delete line', 'Transform to uppercase', 'Transform to lowercase', 'Transform to title case', 'Copy selection as Markdown', 'Share selection as image']),
    );
    expect(commands.find((c) => c.id === 'lines.deleteLine')?.hint).toBe('⇧⌘K');
  });

  it('has nothing without an open file', () => {
    expect(editorCommands({ current: null }, false)).toEqual([]);
  });
});
