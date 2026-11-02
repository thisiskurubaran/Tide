import { configLine, DEFAULT_CONFIG, parseTasks, taskLine } from './tasks';

const tide = JSON.stringify({
  runtime: 'node',
  entry: 'index.js',
  configurations: [
    { name: 'Server', entry: 'server.js', args: ['--port', '3000'] },
    { name: 'Gen', runtime: 'python', entry: 'tools/gen data.py' },
    { name: 'Broken' },
  ],
  tasks: [
    { name: 'Test', command: 'node --test' },
    { name: 'Lint', local: 'node lint.js', remote: 'npx eslint .' },
    { name: 'Deploy', remote: './deploy.sh' },
  ],
});

describe('tasks and run configurations', () => {
  it('reads configurations, defaulting runtime to the top-level one', () => {
    const { configs, error } = parseTasks(tide);
    expect(error).toBeNull();
    expect(configs.map((c) => c.name)).toEqual([DEFAULT_CONFIG, 'Server', 'Gen']);
    expect(configs[1]).toEqual({ name: 'Server', runtime: 'node', entry: 'server.js', args: ['--port', '3000'] });
  });

  it('only offers tasks that have a command for the terminal mode', () => {
    expect(parseTasks(tide, null, 'local').tasks.map((t) => t.name)).toEqual(['Test', 'Lint']);
    const remote = parseTasks(tide, null, 'remote').tasks;
    expect(remote.map((t) => t.name)).toEqual(['Test', 'Lint', 'Deploy']);
    expect(taskLine(remote[1], 'remote')).toBe('npx eslint .');
    expect(taskLine(remote[1], 'local')).toBe('node lint.js');
  });

  it('offers package.json scripts in both terminals', () => {
    const pkg = JSON.stringify({ scripts: { dev: 'vite', 'test:unit': 'jest' } });
    const expected = [
      { name: 'npm: dev', command: 'npm run dev', newTerminal: true },
      { name: 'npm: test:unit', command: 'npm run test:unit', newTerminal: false },
    ];
    expect(parseTasks(null, pkg, 'local').tasks).toEqual(expected);
    expect(parseTasks(null, pkg, 'remote').tasks).toEqual(expected);
    expect(taskLine(expected[1], 'local')).toBe('npm run test:unit');
  });

  it('builds the run line for each mode', () => {
    const [def, server, gen] = parseTasks(tide).configs;
    expect(configLine(def, 'local')).toBe('run\r');
    expect(configLine(server, 'local')).toBe('run Server\r');
    expect(configLine(server, 'remote')).toBe('node server.js --port 3000\r');
    expect(configLine(gen, 'remote')).toBe("python3 'tools/gen data.py'\r");
  });

  it('reports a broken tide.json', () => {
    expect(parseTasks('{ nope').error).toMatch(/valid JSON/);
  });
});
