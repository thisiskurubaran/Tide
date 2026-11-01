// A file's outline: its functions, classes, methods, headings and the like,
// read from the text line by line. No parser, so it works the same for every
// language Tide edits, and it's fast enough to run on every open.
import type { Language } from '../editor/bridge';

export type SymbolKind = 'class' | 'function' | 'method' | 'variable' | 'type' | 'heading' | 'selector' | 'table' | 'module';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  line: number; // 1-based
  depth: number;
}

const MAX_LINE = 400;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'typeof', 'await', 'super', 'constructor']);

// Strings and line comments taken out, so braces inside them don't count.
const code = (line: string) =>
  line
    .replace(/\\./g, '')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""')
    .replace(/\/\/.*$/, '');

function javascript(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let depth = 0;
  // Brace depths where class bodies start, innermost last.
  const classes: number[] = [];
  let inComment = false;
  lines.forEach((raw, i) => {
    let line = raw;
    if (inComment) {
      const end = line.indexOf('*/');
      if (end < 0) return;
      line = line.slice(end + 2);
      inComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    if (line.includes('/*')) {
      inComment = true;
      line = line.slice(0, line.indexOf('/*'));
    }
    const at = classes.length ? classes.length : 0;
    let m: RegExpExecArray | null;
    if ((m = /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(line))) {
      out.push({ name: m[1], kind: 'class', line: i + 1, depth: at });
      classes.push(depth + 1);
    } else if ((m = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line))) {
      out.push({ name: m[1], kind: 'function', line: i + 1, depth: at });
    } else if ((m = /^\s*(?:export\s+)?(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(line))) {
      out.push({ name: m[2], kind: 'type', line: i + 1, depth: at });
    } else if (
      (m = /^\s*(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>)/.exec(line))
    ) {
      out.push({ name: m[1], kind: 'function', line: i + 1, depth: at });
    } else if (classes.length && depth === classes[classes.length - 1]) {
      // A method, a property holding a function, or a getter/setter, in a class body.
      m = /^\s*(?:(?:static|async|get|set|public|private|protected|readonly|override|abstract)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*(?:\(|=\s*(?:async\s+)?\(?[^)]*\)?\s*=>)/.exec(line);
      if (m && !KEYWORDS.has(m[1])) out.push({ name: m[1], kind: 'method', line: i + 1, depth: at });
    }
    for (const ch of code(line)) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (classes.length && depth < classes[classes.length - 1]) classes.pop();
      }
    }
  });
  return out;
}

// Languages where nesting is the indentation.
function indented(lines: string[], patterns: [RegExp, SymbolKind][], nameGroup = 2): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const stack: number[] = [];
  lines.forEach((line, i) => {
    for (const [re, kind] of patterns) {
      const m = re.exec(line);
      if (!m) continue;
      const indent = m[1].replace(/\t/g, '    ').length;
      while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
      const parentIsClass = stack.length > 0;
      out.push({ name: m[nameGroup], kind: kind === 'function' && parentIsClass ? 'method' : kind, line: i + 1, depth: stack.length });
      stack.push(indent);
      break;
    }
  });
  return out;
}

function markdown(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ name: m[2], kind: 'heading', line: i + 1, depth: m[1].length - 1 });
  });
  return out;
}

function css(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let depth = 0;
  lines.forEach((line, i) => {
    const m = /^\s*([^{};/][^{};]*?)\s*\{/.exec(line);
    if (m && depth <= 1) out.push({ name: m[1], kind: m[1].startsWith('@') ? 'module' : 'selector', line: i + 1, depth });
    for (const ch of line.replace(/\/\*.*?\*\//g, '')) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
  });
  return out;
}

function sql(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  lines.forEach((line, i) => {
    const m = /^\s*create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(table|view|index|function|procedure|trigger)\s+(?:if\s+not\s+exists\s+)?["`[]?([\w.]+)/i.exec(line);
    if (m) out.push({ name: m[2], kind: m[1].toLowerCase() === 'table' || m[1].toLowerCase() === 'view' ? 'table' : 'function', line: i + 1, depth: 0 });
  });
  return out;
}

export function symbolsFor(content: string, language: Language): CodeSymbol[] {
  const lines = content.split('\n').map((l) => (l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l));
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'jsx':
    case 'tsx':
      return javascript(lines);
    case 'python':
      return indented(lines, [
        [/^(\s*)class\s+(\w+)/, 'class'],
        [/^(\s*)(?:async\s+)?def\s+(\w+)/, 'function'],
      ]);
    case 'ruby':
      return indented(
        lines,
        [
          [/^(\s*)(?:class|module)\s+([\w:]+)/, 'class'],
          [/^(\s*)def\s+((?:self\.)?[\w?!=]+)/, 'function'],
        ],
      );
    case 'lua':
      return indented(lines, [
        [/^(\s*)(?:local\s+)?function\s+([\w.:]+)/, 'function'],
        [/^(\s*)(?:local\s+)?([\w.]+)\s*=\s*function\b/, 'function'],
      ]);
    case 'php':
      return indented(lines, [
        [/^(\s*)(?:(?:abstract|final)\s+)?(?:class|interface|trait|enum)\s+(\w+)/, 'class'],
        [/^(\s*)(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?(\w+)/, 'function'],
      ]);
    case 'markdown':
      return markdown(lines);
    case 'css':
      return css(lines);
    case 'sql':
      return sql(lines);
    default:
      return [];
  }
}
