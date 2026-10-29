import { classify, LARGE_CHARS, LARGE_LINES } from './largeFiles';

describe('classify', () => {
  it('sorts files by how the editor should open them', () => {
    expect(classify('const a = 1;\n')).toBe('normal');
    expect(classify('x'.repeat(LARGE_CHARS + 1))).toBe('large');
    expect(classify('\n'.repeat(LARGE_LINES))).toBe('large');
    expect(classify('\n'.repeat(LARGE_LINES - 2))).toBe('normal');
    expect(classify('PNG\u0000\u0001')).toBe('binary');
  });
});
