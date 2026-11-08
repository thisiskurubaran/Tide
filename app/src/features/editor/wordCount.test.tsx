import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('../../state', () => {
  const { createMemoryFs } = jest.requireActual('../files/memoryFs');
  const { createWorkspace } = jest.requireActual('../files/workspace');
  const { createBuffersStore } = jest.requireActual('../../state/buffers');
  const { useStore } = jest.requireActual('zustand');
  const workspace = createWorkspace(createMemoryFs());
  const buffersStore = createBuffersStore(workspace);
  return { workspace, buffersStore, useBuffers: (sel: (s: unknown) => unknown) => useStore(buffersStore, sel) };
});

import { buffersStore, workspace } from '../../state';
import { selectionStore } from './selection';
import { countWords, useMarkdownWordCount, wordCountLabel } from './wordCount';

describe('countWords', () => {
  it('counts words, not Markdown markup or link targets', () => {
    expect(countWords('# Title\n\nSome *bold* text, see [the docs](https://x.dev/a-b).\n\n- one\n- two')).toBe(9);
    expect(countWords("it's e-mail 3.5 times")).toBe(4);
    expect(countWords('   ')).toBe(0);
  });

  it('counts each CJK character as a word', () => {
    expect(countWords('日本語 and more')).toBe(5);
  });
});

it('labels words and reading time', () => {
  expect(wordCountLabel(1234)).toBe('1,234 words · 5 min');
  expect(wordCountLabel(1)).toBe('1 word · 1 min');
  expect(wordCountLabel(0)).toBe('0 words · 0 min');
});

function Probe({ path }: { path: string }) {
  return <Text testID="words">{useMarkdownWordCount('p', path) ?? 'none'}</Text>;
}

describe('useMarkdownWordCount', () => {
  beforeAll(async () => {
    await workspace.createEmptyProject('p');
    await workspace.createFile('p', '', 'notes.md', 'one two three four');
    await workspace.createFile('p', '', 'code.js', 'one two');
    await buffersStore.getState().load('p', 'notes.md');
    await buffersStore.getState().load('p', 'code.js');
  });

  it('counts the whole Markdown file, then only the selection', async () => {
    await render(<Probe path="notes.md" />);
    expect(screen.getByTestId('words').props.children).toBe('4 words · 1 min');
    await act(async () => selectionStore.setState({ project: 'p', path: 'notes.md', anchor: 8, head: 0 }));
    expect(screen.getByTestId('words').props.children).toBe('2 words · 1 min');
    await act(async () => selectionStore.setState({ project: 'p', path: 'notes.md', anchor: 3, head: 3 }));
    expect(screen.getByTestId('words').props.children).toBe('4 words · 1 min');
  });

  it('shows nothing for other files', async () => {
    await render(<Probe path="code.js" />);
    expect(screen.getByTestId('words').props.children).toBe('none');
  });
});
