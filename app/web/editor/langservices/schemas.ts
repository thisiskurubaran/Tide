// JSON schemas bundled with the editor, so config files get completions,
// hover docs and validation offline. Hand-written and kept small: the common
// keys with short descriptions, not the full SchemaStore schemas.
import type { JSONSchema } from 'vscode-json-languageservice';

const str = (description: string): JSONSchema => ({ type: 'string', description });
const bool = (description: string): JSONSchema => ({ type: 'boolean', description });
const strings = (description: string): JSONSchema => ({ type: 'array', items: { type: 'string' }, description });
const oneOf = (description: string, values: string[]): JSONSchema => ({ enum: values, description });
const deps = (description: string): JSONSchema => ({
  type: 'object',
  description,
  additionalProperties: { type: 'string', description: 'A version range, tag, URL or path.' },
});
const person: JSONSchema = {
  description: 'A person: "Name <email> (url)" or an object.',
  oneOf: [
    { type: 'string' },
    { type: 'object', properties: { name: str('Name.'), email: str('Email address.'), url: str('Website.') }, required: ['name'] },
  ],
};

const packageJson: JSONSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The package name: lowercase, no spaces, at most 214 characters. May be scoped, like @scope/name.', maxLength: 214, pattern: '^(?:@[a-z0-9-*~][a-z0-9-*._~]*/)?[a-z0-9-~][a-z0-9-._~]*$' },
    version: str('The package version, a semver string such as 1.0.0.'),
    description: str('A short description, shown in npm search.'),
    keywords: strings('Words that help people find the package.'),
    homepage: str('The project home page URL.'),
    bugs: { description: 'Where to report issues.', oneOf: [{ type: 'string' }, { type: 'object', properties: { url: str('Issue tracker URL.'), email: str('Email for issues.') } }] },
    license: str('An SPDX license identifier, such as MIT or ISC, or "UNLICENSED".'),
    author: person,
    contributors: { type: 'array', items: person, description: 'Other people who contributed.' },
    funding: { description: 'Ways to fund the project.' },
    files: strings('Files to include when the package is published.'),
    main: str('The module loaded by require() or import of the package, e.g. index.js.'),
    module: str('An ES module entry point, used by bundlers.'),
    browser: { description: 'A browser-specific entry point, or a map of replacements.' },
    types: str('The bundled TypeScript declaration file.'),
    typings: str('Same as "types".'),
    type: oneOf('How .js files are loaded: "module" for ES modules, "commonjs" (the default) for require().', ['module', 'commonjs']),
    exports: { description: 'Entry points by subpath and condition ("import", "require", "types", "default"). Takes precedence over "main".' },
    imports: { type: 'object', description: 'Private import maps; keys start with #.' },
    bin: { description: 'Executables to install on the PATH: a path, or a map of command name to path.', oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }] },
    man: { description: 'Man pages for the package.' },
    directories: { type: 'object', description: 'Where parts of the package live.' },
    repository: {
      description: 'Where the source code lives.',
      oneOf: [{ type: 'string' }, { type: 'object', properties: { type: str('Usually "git".'), url: str('Repository URL.'), directory: str('Folder of the package in a monorepo.') } }],
    },
    scripts: {
      type: 'object',
      description: 'Commands run with npm run <name>. start, test, build and the pre/post hooks have special meaning.',
      properties: {
        start: str('Run by npm start. Defaults to node server.js.'),
        test: str('Run by npm test.'),
        build: str('Builds the project; run with npm run build.'),
        dev: str('Starts a development server, by convention.'),
        lint: str('Lints the project, by convention.'),
        prepare: str('Runs on local npm install and before publishing.'),
        postinstall: str('Runs after the package is installed.'),
        prepublishOnly: str('Runs before npm publish only.'),
      },
      additionalProperties: { type: 'string' },
    },
    config: { type: 'object', description: 'Values exposed to scripts as npm_package_config_*.' },
    dependencies: deps('Packages needed at run time.'),
    devDependencies: deps('Packages needed only for development and tests.'),
    peerDependencies: deps('Packages the host project must provide.'),
    peerDependenciesMeta: { type: 'object', description: 'Marks peer dependencies as optional.', additionalProperties: { type: 'object', properties: { optional: bool('Not an error if missing.') } } },
    optionalDependencies: deps('Packages that may fail to install without failing the install.'),
    bundleDependencies: { description: 'Packages bundled when publishing.', oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'boolean' }] },
    overrides: { type: 'object', description: 'Replaces versions of packages deep in the dependency tree (npm).' },
    resolutions: { type: 'object', description: 'Replaces versions of packages deep in the dependency tree (Yarn).' },
    engines: { type: 'object', description: 'Versions of Node or npm the package works with.', properties: { node: str('A semver range of Node versions.'), npm: str('A semver range of npm versions.') }, additionalProperties: { type: 'string' } },
    os: strings('Operating systems the package runs on.'),
    cpu: strings('CPU architectures the package runs on.'),
    private: bool('If true, npm refuses to publish the package.'),
    publishConfig: { type: 'object', description: 'Settings used when publishing, such as registry and access.' },
    workspaces: { description: 'Folders of packages in this monorepo.', oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'object' }] },
    packageManager: str('The package manager and version, e.g. pnpm@9.0.0 (used by Corepack).'),
    sideEffects: { description: 'false, or the files that have side effects, so bundlers can tree-shake.', oneOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'string' } }] },
  },
};

const target = ['ES3', 'ES5', 'ES6', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019', 'ES2020', 'ES2021', 'ES2022', 'ES2023', 'ES2024', 'ESNext'];
const compilerOptions: JSONSchema = {
  type: 'object',
  description: 'Options for the TypeScript compiler.',
  properties: {
    target: { description: 'The JavaScript version to emit.', anyOf: [{ enum: target }, { type: 'string' }] },
    module: { description: 'The module system of the emitted code.', anyOf: [{ enum: ['CommonJS', 'AMD', 'UMD', 'System', 'ES6', 'ES2015', 'ES2020', 'ES2022', 'ESNext', 'Node16', 'Node18', 'NodeNext', 'Preserve', 'None'] }, { type: 'string' }] },
    moduleResolution: { description: 'How imports are resolved to files.', anyOf: [{ enum: ['Node', 'Node10', 'Node16', 'NodeNext', 'Bundler', 'Classic'] }, { type: 'string' }] },
    lib: strings('Built-in declaration sets to include, e.g. ["ES2022", "DOM"].'),
    jsx: oneOf('How JSX is emitted.', ['preserve', 'react', 'react-jsx', 'react-jsxdev', 'react-native']),
    jsxImportSource: str('The module that provides the JSX runtime, e.g. react or preact.'),
    strict: bool('Turns on all strict type checks.'),
    noImplicitAny: bool('Reports values whose type is implicitly any.'),
    strictNullChecks: bool('null and undefined are not part of every type.'),
    noUnusedLocals: bool('Reports unused local variables.'),
    noUnusedParameters: bool('Reports unused function parameters.'),
    noImplicitReturns: bool('Reports code paths that do not return a value.'),
    noFallthroughCasesInSwitch: bool('Reports switch cases that fall through.'),
    noUncheckedIndexedAccess: bool('Adds undefined to the type of index accesses.'),
    exactOptionalPropertyTypes: bool('Optional properties cannot be set to undefined explicitly.'),
    allowJs: bool('Allows .js files to be compiled.'),
    checkJs: bool('Reports type errors in .js files.'),
    esModuleInterop: bool('Emits helpers for importing CommonJS modules as default imports.'),
    allowSyntheticDefaultImports: bool('Allows default imports from modules without a default export.'),
    skipLibCheck: bool('Skips type checking of declaration files.'),
    forceConsistentCasingInFileNames: bool('Reports imports whose casing differs from the file name.'),
    resolveJsonModule: bool('Allows importing .json files.'),
    isolatedModules: bool('Reports code that cannot be compiled one file at a time.'),
    verbatimModuleSyntax: bool('Imports and exports are kept as written, except "import type".'),
    declaration: bool('Emits .d.ts files.'),
    declarationMap: bool('Emits source maps for .d.ts files.'),
    sourceMap: bool('Emits .map files.'),
    noEmit: bool('Type checks only; writes no files.'),
    outDir: str('Folder for emitted files.'),
    rootDir: str('The root of the input files, mirrored in outDir.'),
    baseUrl: str('The folder non-relative imports are resolved from.'),
    paths: { type: 'object', description: 'Import path aliases, e.g. { "@/*": ["src/*"] }.', additionalProperties: { type: 'array', items: { type: 'string' } } },
    types: strings('Only these @types packages are included automatically.'),
    typeRoots: strings('Folders to load type packages from.'),
    incremental: bool('Saves build info to speed up later builds.'),
    composite: bool('Enables project references for this project.'),
    experimentalDecorators: bool('Enables legacy decorators.'),
    emitDecoratorMetadata: bool('Emits design-type metadata for decorators.'),
    useDefineForClassFields: bool('Uses standard class field semantics.'),
    downlevelIteration: bool('Emits accurate iteration for older targets.'),
    removeComments: bool('Strips comments from the output.'),
  },
};
const tsconfig: JSONSchema = {
  type: 'object',
  properties: {
    extends: { description: 'A config file (or files) to inherit from.', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    compilerOptions,
    include: strings('Globs of files to compile.'),
    exclude: strings('Globs of files to leave out of "include".'),
    files: strings('Exact files to compile.'),
    references: { type: 'array', description: 'Projects this one depends on.', items: { type: 'object', properties: { path: str('Path to the referenced project.') }, required: ['path'] } },
    compileOnSave: bool('Asks editors to compile on save.'),
    watchOptions: { type: 'object', description: 'How --watch watches files.' },
  },
};

const ruleLevel: JSONSchema = {
  description: '"off" or 0, "warn" or 1, "error" or 2; or an array with the level first, then options.',
  oneOf: [{ enum: ['off', 'warn', 'error', 0, 1, 2] }, { type: 'array', items: [{ enum: ['off', 'warn', 'error', 0, 1, 2] }] }],
};
const eslintBase: JSONSchema = {
  type: 'object',
  properties: {
    env: { type: 'object', description: 'Predefined globals, e.g. { "browser": true, "node": true, "es2022": true }.', additionalProperties: { type: 'boolean' } },
    extends: { description: 'Configs to build on, e.g. "eslint:recommended".', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    globals: { type: 'object', description: 'Extra global variables: "readonly", "writable" or "off".', additionalProperties: { enum: ['readonly', 'writable', 'off', true, false] } },
    parser: str('The parser module, e.g. @typescript-eslint/parser.'),
    parserOptions: {
      type: 'object',
      description: 'Options passed to the parser.',
      properties: {
        ecmaVersion: { description: 'The JavaScript version to parse, or "latest".', anyOf: [{ type: 'number' }, { enum: ['latest'] }] },
        sourceType: oneOf('"module" for ES modules, "script" otherwise.', ['module', 'script', 'commonjs']),
        ecmaFeatures: { type: 'object', properties: { jsx: bool('Parses JSX.') } },
        project: { description: 'tsconfig files for type-aware rules.' },
      },
    },
    plugins: strings('Plugins that provide extra rules, without the eslint-plugin- prefix.'),
    rules: { type: 'object', description: 'Rule names and their levels.', additionalProperties: ruleLevel },
    settings: { type: 'object', description: 'Shared settings every rule can read.' },
    ignorePatterns: { description: 'Files to skip.', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  },
};
const eslintrc: JSONSchema = {
  ...eslintBase,
  properties: {
    ...eslintBase.properties,
    root: bool('Stops ESLint looking for configs in parent folders.'),
    overrides: {
      type: 'array',
      description: 'Settings for files matching globs.',
      items: { ...eslintBase, properties: { ...eslintBase.properties, files: strings('Globs the override applies to.'), excludedFiles: strings('Globs to leave out.') } },
    },
  },
};

const prettierOptions: Record<string, JSONSchema> = {
  printWidth: { type: 'integer', description: 'Line length to wrap at. Default 80.' },
  tabWidth: { type: 'integer', description: 'Spaces per indent level. Default 2.' },
  useTabs: bool('Indents with tabs. Default false.'),
  semi: bool('Adds semicolons at the end of statements. Default true.'),
  singleQuote: bool('Uses single quotes. Default false.'),
  jsxSingleQuote: bool('Uses single quotes in JSX. Default false.'),
  quoteProps: oneOf('When to quote object keys. Default "as-needed".', ['as-needed', 'consistent', 'preserve']),
  trailingComma: oneOf('Trailing commas where valid. Default "all".', ['all', 'es5', 'none']),
  bracketSpacing: bool('Spaces inside object braces. Default true.'),
  bracketSameLine: bool('Puts the > of a multi-line tag on the last line. Default false.'),
  arrowParens: oneOf('Parentheses around a single arrow function parameter. Default "always".', ['always', 'avoid']),
  proseWrap: oneOf('How Markdown text is wrapped. Default "preserve".', ['always', 'never', 'preserve']),
  htmlWhitespaceSensitivity: oneOf('How whitespace in HTML is treated. Default "css".', ['css', 'strict', 'ignore']),
  endOfLine: oneOf('Line endings. Default "lf".', ['lf', 'crlf', 'cr', 'auto']),
  embeddedLanguageFormatting: oneOf('Formats code embedded in other files. Default "auto".', ['auto', 'off']),
  singleAttributePerLine: bool('One attribute per line in HTML and JSX. Default false.'),
  vueIndentScriptAndStyle: bool('Indents <script> and <style> in Vue files. Default false.'),
  parser: str('Forces a parser, e.g. "babel", "typescript", "css", "json".'),
  plugins: strings('Prettier plugins to load.'),
};
const prettierrc: JSONSchema = {
  type: 'object',
  properties: {
    ...prettierOptions,
    overrides: {
      type: 'array',
      description: 'Options for files matching globs.',
      items: { type: 'object', properties: { files: { description: 'Globs.', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] }, excludeFiles: { description: 'Globs to leave out.' }, options: { type: 'object', properties: prettierOptions } }, required: ['files'] },
    },
  },
};

// Tide's run config; see src/features/files/templates.ts and project/tasks.ts.
const runtime = oneOf('What runs the entry file.', ['node', 'python', 'lua', 'ruby', 'php']);
const args = strings('Arguments passed to the program.');
const tideJson: JSONSchema = {
  type: 'object',
  properties: {
    runtime,
    entry: str('The file ⌘R runs, relative to the project, e.g. index.js or main.py.'),
    args,
    configurations: {
      type: 'array',
      description: 'More ways to run the project, picked in the command palette. Missing runtime is taken from the top level.',
      items: {
        type: 'object',
        properties: { name: str('Shown in the palette; must be unique.'), runtime, entry: str('The file this configuration runs.'), args },
        required: ['name', 'entry'],
      },
    },
    tasks: {
      type: 'array',
      description: 'Command lines typed into the terminal, picked in the command palette.',
      items: {
        type: 'object',
        properties: {
          name: str('Shown in the palette; must be unique.'),
          command: str('The command line to run.'),
          local: str('Replaces "command" in the on-device terminal.'),
          remote: str('Replaces "command" in a remote terminal.'),
          newTerminal: bool('Runs in a new terminal tab, e.g. for a server that keeps running.'),
        },
        required: ['name'],
      },
    },
  },
};

export const SCHEMAS: { uri: string; fileMatch: string[]; schema: JSONSchema }[] = [
  { uri: 'tide://schemas/package.json', fileMatch: ['package.json'], schema: packageJson },
  { uri: 'tide://schemas/tsconfig.json', fileMatch: ['tsconfig.json', 'tsconfig.*.json', 'jsconfig.json', 'jsconfig.*.json'], schema: tsconfig },
  { uri: 'tide://schemas/eslintrc.json', fileMatch: ['.eslintrc', '.eslintrc.json'], schema: eslintrc },
  { uri: 'tide://schemas/prettierrc.json', fileMatch: ['.prettierrc', '.prettierrc.json'], schema: prettierrc },
  { uri: 'tide://schemas/tide.json', fileMatch: ['tide.json'], schema: tideJson },
];
