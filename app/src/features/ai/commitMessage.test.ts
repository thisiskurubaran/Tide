/**
 * @jest-environment node
 */
jest.mock('expo-secure-store', () => require('./testMocks').secureStoreMock());
jest.mock('../../state', () => require('./testMocks').stateMock());

import { cleanMessage, formatChanges, suggestCommitMessage } from './commitMessage';
import { aiSettings, setKey } from './settings';
import { fakeFetch, json } from './testMocks';

describe('commit messages', () => {
  it('formats changes as a compact diff, and cuts big ones', () => {
    const text = formatChanges([
      { path: 'src/sum.js', before: 'const a = 1;\nexport const sum = (a, b) => a - b;\n', after: 'const a = 1;\nexport const sum = (a, b) => a + b;\n' },
      { path: 'README.md', before: null, after: '# Hi\n' },
      { path: 'old.txt', before: 'bye\n', after: null },
      { path: 'logo.png', before: null, after: null, binary: true },
    ]);
    expect(text).toContain('--- modified src/sum.js');
    expect(text).toContain('-export const sum = (a, b) => a - b;');
    expect(text).toContain('+export const sum = (a, b) => a + b;');
    expect(text).toContain('--- new file README.md\n@@ -0,0 +1,1 @@\n+# Hi');
    expect(text).toContain('--- deleted old.txt');
    expect(text).toContain('logo.png (binary)');
    const big = formatChanges([{ path: 'a', before: '', after: 'x\n'.repeat(5000) }], 500);
    expect(big.length).toBeLessThan(600);
    expect(big).toContain('[diff cut off; 1 files changed in total]');
  });

  it('cleans up fences, quotes and lead-ins', () => {
    expect(cleanMessage('```\nFix sum to add\n```')).toBe('Fix sum to add');
    expect(cleanMessage('Commit message: Fix sum')).toBe('Fix sum');
    expect(cleanMessage('"Fix sum"')).toBe('Fix sum');
    expect(cleanMessage('Fix sum\n\nIt subtracted.')).toBe('Fix sum\n\nIt subtracted.');
  });

  it('asks the chat model with the diff and returns the message', async () => {
    await setKey('anthropic', 'sk-ant-test');
    aiSettings.getState().setJob('chat', { provider: 'anthropic', model: 'claude-haiku-5-5' });
    const f = fakeFetch(() => json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fix sum to add numbers' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    const realFetch = global.fetch;
    global.fetch = f.fetch;
    try {
      const msg = await suggestCommitMessage('--- modified a.js\n+x');
      expect(msg).toBe('Fix sum to add numbers');
      expect(f.calls[0].body.model).toBe('claude-haiku-5-5');
      expect(f.calls[0].body.max_tokens).toBe(1000);
      expect(f.calls[0].body.messages[0].content).toContain('--- modified a.js');
      await expect(suggestCommitMessage('  ')).rejects.toThrow('no changes');
    } finally {
      global.fetch = realFetch;
    }
  });
});
