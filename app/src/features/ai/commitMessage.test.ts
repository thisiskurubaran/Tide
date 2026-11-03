import { cleanMessage, formatChanges } from './commitMessage';
import { createClient } from './assistant';
import { suggestCommitMessage } from './commitMessage';

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

  it('asks Claude with the diff and returns the message', async () => {
    const calls: { body: { model: string; messages: { content: string }[] } }[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      calls.push({ body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fix sum to add numbers' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const msg = await suggestCommitMessage(createClient('sk-ant-test', fetchImpl), 'claude-haiku-5-5', '--- modified a.js\n+x');
    expect(msg).toBe('Fix sum to add numbers');
    expect(calls[0].body.messages[0].content).toContain('--- modified a.js');
    await expect(suggestCommitMessage(createClient('k', fetchImpl), 'claude-haiku-5-5', '  ')).rejects.toThrow('no changes');
  });
});
