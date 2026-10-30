import type { Runtime } from '@shared/protocol';

// tide.json is the project's run config; the shell's `run` command reads it.
export interface RunConfig {
  runtime: Runtime;
  entry: string;
  args?: string[];
  // More ways to run the project, picked in the palette; see project/tasks.ts.
  configurations?: (Partial<RunConfig> & { name: string })[];
  tasks?: unknown[];
}

export interface Template {
  id: string;
  label: string;
  description: string;
  run: RunConfig;
  files: Record<string, string>;
}

export const RUN_CONFIG_FILE = 'tide.json';

export const templates: Template[] = [
  {
    id: 'node-hello',
    label: 'Node hello',
    description: 'A single index.js that prints a greeting.',
    run: { runtime: 'node', entry: 'index.js' },
    files: {
      'index.js': `const name = process.argv[2] ?? 'world';\n\nconsole.log(\`Hello, \${name}!\`);\n`,
    },
  },
  {
    id: 'python-hello',
    label: 'Python hello',
    description: 'A single main.py that asks for your name.',
    run: { runtime: 'python', entry: 'main.py' },
    files: {
      'main.py': `name = input("What's your name? ") or "world"\nprint(f"Hello, {name}!")\n`,
    },
  },
  {
    id: 'lua-hello',
    label: 'Lua hello',
    description: 'A single main.lua that asks for your name.',
    run: { runtime: 'lua', entry: 'main.lua' },
    files: {
      'main.lua': `io.write("What's your name? ")\nlocal name = io.read()\nif name == nil or name == "" then name = "world" end\nprint("Hello, " .. name .. "!")\n`,
    },
  },
  {
    id: 'ruby-hello',
    label: 'Ruby hello',
    description: 'A single main.rb that greets a list of names.',
    run: { runtime: 'ruby', entry: 'main.rb' },
    files: {
      'main.rb': `names = ARGV.empty? ? %w[Ada Grace Alan] : ARGV\n\nnames.each_with_index do |name, i|\n  puts "#{i + 1}. Hello, #{name}!"\nend\n`,
    },
  },
  {
    id: 'php-hello',
    label: 'PHP hello',
    description: 'A single index.php that prints a greeting.',
    run: { runtime: 'php', entry: 'index.php' },
    files: {
      'index.php': `<?php\n\n$name = $argv[1] ?? 'world';\necho "Hello, {$name}!" . PHP_EOL;\necho 'PHP ' . PHP_VERSION . PHP_EOL;\n`,
    },
  },
  {
    id: 'express-api',
    label: 'Express API',
    description: 'An Express server with one JSON route. Needs npm install.',
    run: { runtime: 'node', entry: 'index.js' },
    files: {
      'package.json': `${JSON.stringify(
        {
          name: 'express-api',
          version: '1.0.0',
          private: true,
          main: 'index.js',
          // Express 5's router uses Unicode regex escapes, which nodejs-mobile (built without Intl) rejects.
          dependencies: { express: '^4.22.0' },
        },
        null,
        2,
      )}\n`,
      'index.js': [
        "const express = require('express');",
        '',
        'const app = express();',
        'const port = process.env.PORT ?? 3000;',
        '',
        "app.get('/', (req, res) => {",
        "  res.json({ message: 'Hello from Tide' });",
        '});',
        '',
        'app.listen(port, () => {',
        '  console.log(`Listening on http://localhost:${port}`);',
        '});',
        '',
      ].join('\n'),
    },
  },
];

export function findTemplate(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
