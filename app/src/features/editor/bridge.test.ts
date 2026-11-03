import { ALL_GESTURES, CODE_FONTS, isCodeFont, languageFor, parseFromEditor, parseToEditor } from './bridge';

describe('languageFor', () => {
  it.each([
    ['index.js', 'javascript'],
    ['src/app.MJS', 'javascript'],
    ['App.tsx', 'tsx'],
    ['lib/util.ts', 'typescript'],
    ['main.py', 'python'],
    ['package.json', 'json'],
    ['index.html', 'html'],
    ['styles.css', 'css'],
    ['theme.scss', 'scss'],
    ['vars.less', 'less'],
    ['.prettierrc', 'json'],
    ['settings.jsonc', 'json'],
    ['README.md', 'markdown'],
    ['Makefile', 'makefile'],
    ['src/GNUmakefile', 'makefile'],
    ['rules.mk', 'makefile'],
    ['config.yml', 'yaml'],
    ['.github/workflows/ci.yaml', 'yaml'],
    ['Cargo.toml', 'toml'],
    ['Dockerfile', 'dockerfile'],
    ['Dockerfile.dev', 'dockerfile'],
    ['api.dockerfile', 'dockerfile'],
    ['Containerfile', 'dockerfile'],
    ['setup.cfg', 'ini'],
    ['app.properties', 'ini'],
    ['.env', 'env'],
    ['.env.local', 'env'],
    ['run.sh', 'shell'],
    ['.zshrc', 'shell'],
    ['.profile', 'shell'],
    ['build.ps1', 'powershell'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['Main.java', 'java'],
    ['util.c', 'c'],
    ['util.h', 'c'],
    ['app.cpp', 'cpp'],
    ['app.HPP', 'cpp'],
    ['View.m', 'objectivec'],
    ['Program.cs', 'csharp'],
    ['build.gradle.kts', 'kotlin'],
    ['App.swift', 'swift'],
    ['main.dart', 'dart'],
    ['Info.plist', 'xml'],
    ['logo.svg', 'xml'],
    ['App.csproj', 'xml'],
    ['.gitignore', 'plain'],
    ['notes.txt', 'plain'],
    ['dir.v2/file', 'plain'],
  ])('%s -> %s', (path, lang) => {
    expect(languageFor(path)).toBe(lang);
  });
});

describe('message parsing', () => {
  it('accepts known messages in each direction', () => {
    expect(parseFromEditor(JSON.stringify({ type: 'change', path: 'a.js', content: 'x' }))).toEqual({
      type: 'change',
      path: 'a.js',
      content: 'x',
    });
    expect(parseToEditor(JSON.stringify({ type: 'key', key: 'left' }))).toEqual({ type: 'key', key: 'left' });
  });

  it('rejects unknown types, wrong direction and non-JSON', () => {
    expect(parseFromEditor('{"type":"open"}')).toBeNull();
    expect(parseToEditor('{"type":"ready"}')).toBeNull();
    expect(parseFromEditor('not json')).toBeNull();
    expect(parseFromEditor('null')).toBeNull();
    expect(parseFromEditor('"ready"')).toBeNull();
  });

  it('accepts setFont only with a known font and a boolean ligatures flag', () => {
    const msg = { type: 'setFont', font: 'fira-code', ligatures: true };
    expect(parseToEditor(JSON.stringify(msg))).toEqual(msg);
    expect(parseToEditor(JSON.stringify({ ...msg, font: 'comic-sans' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ ...msg, font: 'toString' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ ...msg, ligatures: 'yes' }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ type: 'setFont' }))).toBeNull();
    // Only the app sends it.
    expect(parseFromEditor(JSON.stringify(msg))).toBeNull();
  });

  it('accepts setGestures only with every flag as a boolean, and actions from the editor', () => {
    const msg = { type: 'setGestures', gestures: ALL_GESTURES };
    expect(parseToEditor(JSON.stringify(msg))).toEqual(msg);
    expect(parseToEditor(JSON.stringify({ type: 'setGestures', gestures: { ...ALL_GESTURES, pinch: 'yes' } }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ type: 'setGestures', gestures: { tabs: true } }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ type: 'setGestures' }))).toBeNull();
    expect(parseFromEditor(JSON.stringify({ type: 'actions' }))).toEqual({ type: 'actions' });
  });
});

describe('inline completion messages', () => {
  const to = (m: object) => parseToEditor(JSON.stringify(m));
  const from = (m: object) => parseFromEditor(JSON.stringify(m));

  it('accepts well-formed messages both ways', () => {
    expect(to({ type: 'setCompletions', enabled: true, model: 'claude-haiku-5-5' })).toBeTruthy();
    expect(to({ type: 'setCompletions', enabled: false })).toBeTruthy();
    expect(to({ type: 'completion', requestId: 4, text: 'foo()' })).toBeTruthy();
    expect(to({ type: 'acceptCompletion', part: 'word' })).toBeTruthy();
    expect(to({ type: 'dismissCompletion' })).toBeTruthy();
    expect(to({ type: 'nextCompletion' })).toBeTruthy();
    expect(from({ type: 'requestCompletion', requestId: 1, path: 'a.ts', prefix: 'con', suffix: '' })).toBeTruthy();
    expect(from({ type: 'completionState', visible: true })).toBeTruthy();
  });

  it('rejects bad fields and the wrong direction', () => {
    expect(to({ type: 'setCompletions', enabled: 'yes' })).toBeNull();
    expect(to({ type: 'setCompletions', enabled: true, model: 3 })).toBeNull();
    expect(to({ type: 'completion', requestId: '4', text: 'x' })).toBeNull();
    expect(to({ type: 'completion', requestId: 4 })).toBeNull();
    expect(to({ type: 'acceptCompletion', part: 'line' })).toBeNull();
    expect(from({ type: 'requestCompletion', requestId: 1, path: 'a.ts', prefix: 'x' })).toBeNull();
    expect(from({ type: 'completionState' })).toBeNull();
    expect(from({ type: 'completion', requestId: 1, text: 'x' })).toBeNull();
    expect(to({ type: 'requestCompletion', requestId: 1, path: 'a', prefix: '', suffix: '' })).toBeNull();
  });
});

describe('fix with AI messages', () => {
  it('accepts setAiFix and fixProblem with valid fields, each in its own direction', () => {
    expect(parseToEditor(JSON.stringify({ type: 'setAiFix', enabled: true }))).toEqual({ type: 'setAiFix', enabled: true });
    expect(parseToEditor(JSON.stringify({ type: 'setAiFix', enabled: 'yes' }))).toBeNull();
    expect(parseFromEditor(JSON.stringify({ type: 'fixProblem', path: 'a.ts', line: 3 }))).toEqual({ type: 'fixProblem', path: 'a.ts', line: 3 });
    expect(parseFromEditor(JSON.stringify({ type: 'fixProblem', path: 'a.ts', line: 0 }))).toBeNull();
    expect(parseFromEditor(JSON.stringify({ type: 'fixProblem', path: 3, line: 1 }))).toBeNull();
    expect(parseToEditor(JSON.stringify({ type: 'fixProblem', path: 'a.ts', line: 3 }))).toBeNull();
  });
});

describe('code fonts', () => {
  it('knows the bundled fonts by id', () => {
    expect(Object.keys(CODE_FONTS)).toEqual(['jetbrains-mono', 'fira-code', 'ibm-plex-mono', 'source-code-pro']);
    expect(isCodeFont('ibm-plex-mono')).toBe(true);
    expect(isCodeFont('hasOwnProperty')).toBe(false);
    expect(isCodeFont(undefined)).toBe(false);
  });
});
