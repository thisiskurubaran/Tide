import { createMemoryFs } from '../../files/memoryFs';
import { createTerminalHistory, HISTORY_DIR, looksSecret, shouldRecord } from './history';

const file = (project: string) => `${HISTORY_DIR}/${encodeURIComponent(project)}.json`;
const saved = (fs: ReturnType<typeof createMemoryFs>, project: string) => JSON.parse(fs.files.get(file(project)) ?? 'null')?.entries;

describe('looksSecret', () => {
  it.each([
    'export GITHUB_TOKEN=ghp_abc',
    'export X_TOKEN=abc123',
    'API_KEY=xyz node server.js',
    'env DB_PASSWORD=hunter2 npm start',
    'mysql --password=hunter2',
    'npm publish --otp 123456',
    'login --token abc',
    'tool --client-secret=abc',
    'curl -H "Authorization: Bearer abcdefghijklmnop" https://api.example.com',
    "curl -H 'X-Api-Key: 1234' https://api.example.com",
    'curl -u ada:hunter2 https://example.com',
    'git clone https://ada:hunter2@github.com/ada/app.git',
    'echo ghp_0123456789abcdefghijABCDEFGHIJ',
    'node send.js sk-ant-api03-abcdefghijklmnopqrstu',
    'aws configure set aws_access_key_id AKIAABCDEFGHIJKLMNOP',
    'echo eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
    'sshpass -p hunter2 ssh host',
  ])('flags %s', (line) => {
    expect(looksSecret(line)).toBe(true);
  });

  it.each([
    'npm run dev',
    'git commit -m "fix token refresh"',
    'echo $API_KEY',
    'ls -la src',
    'git log --format=%h',
    'PORT=3000 node server.js',
    'node --test',
    'git clone https://github.com/ada/app.git',
    'npm install --save-dev typescript',
  ])('keeps %s', (line) => {
    expect(looksSecret(line)).toBe(false);
  });
});

describe('shouldRecord', () => {
  it('skips blanks, a repeat of the previous line, and lines starting with a space', () => {
    expect(shouldRecord('ls', undefined)).toBe(true);
    expect(shouldRecord('   ', undefined)).toBe(false);
    expect(shouldRecord('ls', 'ls')).toBe(false);
    expect(shouldRecord('ls -a', 'ls')).toBe(true);
    expect(shouldRecord(' cat .env', 'ls')).toBe(false);
    expect(shouldRecord('export SECRET=1', 'ls')).toBe(false);
  });
});

describe('terminal history', () => {
  it('saves per project and loads it back after a restart', async () => {
    const fs = createMemoryFs();
    const h = createTerminalHistory(fs).forProject('demo');
    await h.load();
    h.add('ls');
    h.add('npm run dev');
    await h.clear().then(() => undefined);
    h.add('git status');
    h.add('git status');
    h.add(' secret stuff');
    h.add('export MY_TOKEN=abc');
    await h.load();
    const other = createTerminalHistory(fs).forProject('other');
    other.add('pwd');
    await other.load();
    // Writes are queued; wait for them.
    await new Promise((r) => setTimeout(r, 0));
    expect(saved(fs, 'demo')).toEqual(['git status']);
    expect(saved(fs, 'other')).toEqual(['pwd']);

    const restarted = createTerminalHistory(fs).forProject('demo');
    expect(restarted.entries).toEqual([]);
    await restarted.load();
    expect(restarted.entries).toEqual(['git status']);
  });

  it('is shared by every terminal of a project', () => {
    const store = createTerminalHistory(createMemoryFs());
    expect(store.forProject('demo')).toBe(store.forProject('demo'));
    expect(store.forProject('demo')).not.toBe(store.forProject('other'));
  });

  it('keeps lines typed before the saved history loaded, after the saved ones', async () => {
    const fs = createMemoryFs();
    fs.files.set(file('demo'), JSON.stringify({ version: 1, entries: ['one', 'two'] }));
    const h = createTerminalHistory(fs).forProject('demo');
    h.add('two');
    h.add('three');
    await h.load();
    expect(h.entries).toEqual(['one', 'two', 'three']);
    await new Promise((r) => setTimeout(r, 0));
    expect(saved(fs, 'demo')).toEqual(['one', 'two', 'three']);
  });

  it('keeps the newest 500 entries', async () => {
    const fs = createMemoryFs();
    const h = createTerminalHistory(fs).forProject('demo');
    await h.load();
    for (let i = 0; i < 520; i++) h.add(`echo ${i}`);
    expect(h.entries).toHaveLength(500);
    expect(h.entries[0]).toBe('echo 20');
    expect(h.entries[499]).toBe('echo 519');
    await new Promise((r) => setTimeout(r, 0));
    expect(saved(fs, 'demo')).toHaveLength(500);
  });

  it('drops secret-looking lines and junk from a saved file', async () => {
    const fs = createMemoryFs();
    fs.files.set(file('demo'), JSON.stringify({ version: 1, entries: ['ls', 'export API_KEY=1', 3, ''] }));
    const h = createTerminalHistory(fs).forProject('demo');
    await h.load();
    expect(h.entries).toEqual(['ls']);
  });

  it('starts empty from a damaged file, and overwrites it', async () => {
    const fs = createMemoryFs();
    fs.files.set(file('demo'), '{"entr');
    const h = createTerminalHistory(fs).forProject('demo');
    await h.load();
    expect(h.entries).toEqual([]);
    h.add('ls');
    await new Promise((r) => setTimeout(r, 0));
    expect(saved(fs, 'demo')).toEqual(['ls']);
  });

  it("doesn't overwrite a file it couldn't read", async () => {
    const fs = createMemoryFs();
    fs.files.set(file('demo'), JSON.stringify({ version: 1, entries: ['keep me'] }));
    const readFile = fs.readFile;
    fs.readFile = async () => {
      throw new Error('EIO');
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = createTerminalHistory(fs).forProject('demo');
    h.add('ls');
    await h.load();
    await new Promise((r) => setTimeout(r, 0));
    fs.readFile = readFile;
    expect(saved(fs, 'demo')).toEqual(['keep me']);
    expect(h.entries).toEqual(['ls']);
    warn.mockRestore();
  });

  it('follows project renames and deletes', async () => {
    const fs = createMemoryFs();
    const store = createTerminalHistory(fs);
    const h = store.forProject('a b');
    h.add('ls');
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.files.has(file('a b'))).toBe(true);
    await store.renameProject('a b', 'c');
    expect(fs.files.has(file('a b'))).toBe(false);
    expect(saved(fs, 'c')).toEqual(['ls']);
    expect(store.forProject('c')).toBe(h);
    h.add('pwd');
    await new Promise((r) => setTimeout(r, 0));
    expect(saved(fs, 'c')).toEqual(['ls', 'pwd']);
    await store.removeProject('c');
    expect(fs.files.has(file('c'))).toBe(false);
  });
});
