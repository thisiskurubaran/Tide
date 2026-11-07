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

interface Found {
  name: string;
  kind: SymbolKind;
  // Its body holds members: methods, nested types.
  container?: boolean;
}

// What a line declares, given the type whose body it sits in (if any).
type Matcher = (line: string, inside: string | undefined) => Found | null;

// Brace languages (C, Java, Rust...): declarations are only read at the top
// level or directly in a type's body, so statements inside function bodies
// never count. `strip` takes out what would confuse the brace count.
function braces(lines: string[], match: Matcher, strip: (line: string) => string = (l) => l): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let depth = 0;
  // Open type bodies, innermost last: the depth inside them and their name.
  const open: { depth: number; name: string }[] = [];
  // A type whose opening brace is on a later line (Allman style).
  let pending: string | null = null;
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
    const plain = code(strip(line));
    if (pending !== null) {
      if (/^\s*\{/.test(plain)) open.push({ depth: depth + 1, name: pending });
      if (plain.trim()) pending = null;
    }
    const top = open[open.length - 1];
    if (depth === (top ? top.depth : 0) && !/^\s*#/.test(line)) {
      const found = match(line, top?.name);
      if (found) {
        out.push({ name: found.name, kind: found.kind === 'function' && top ? 'method' : found.kind, line: i + 1, depth: open.length });
        if (found.container) {
          if (plain.includes('{')) open.push({ depth: depth + 1, name: found.name });
          else if (!/;\s*$/.test(plain)) pending = found.name;
        }
      }
    }
    for (const ch of plain) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        while (open.length && depth < open[open.length - 1].depth) open.pop();
      }
    }
  });
  return out;
}

const NOT_NAMES = new Set([
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try', 'new', 'delete', 'throw', 'sizeof', 'case', 'using', 'lock', 'when', 'await', 'typeof', 'assert', 'synchronized', 'defined', 'elif', 'goto',
]);
const typed = (type: string | undefined) => !!type && !NOT_NAMES.has(type.trim().split(/\s+/)[0]);

const rule = (re: RegExp, kind: SymbolKind, container = false, group = 1) => (line: string): Found | null => {
  const m = re.exec(line);
  return m && m[group] ? { name: m[group], kind, container } : null;
};
const first = (...rules: ((line: string, inside: string | undefined) => Found | null)[]): Matcher => (line, inside) => {
  for (const r of rules) {
    const f = r(line, inside);
    if (f) return f;
  }
  return null;
};

// `type name(` with modifiers before; a constructor has no type but its class's name.
const typedFunction = (modifiers: string) => {
  const re = new RegExp(`^\\s*(?:(?:${modifiers})\\s+)*(?:<[^>]*>\\s*)?((?:[\\w.:]+(?:<[^()]*?>)?[?*&\\[\\]]*\\s+)+?(?:[*&]+\\s*)?)?(~?[A-Za-z_]\\w*(?:::~?[A-Za-z_]\\w*)*)\\s*(?:<[^()]*>)?\\s*\\(`);
  return (line: string, inside: string | undefined): Found | null => {
    const m = re.exec(line);
    if (!m || NOT_NAMES.has(m[2])) return null;
    const bare = m[2].replace(/^.*::/, '').replace(/^~/, '');
    if (typed(m[1]) || m[2].includes('::') || (inside !== undefined && bare === inside)) return { name: m[2], kind: 'function' };
    return null;
  };
};

const JAVA_MODS = 'public|private|protected|static|final|abstract|synchronized|native|default|strictfp|sealed|non-sealed|transient';
const CSHARP_MODS = 'public|private|protected|internal|static|virtual|override|abstract|sealed|async|extern|unsafe|partial|new|readonly|ref';
const CPP_MODS = 'static|inline|extern|virtual|explicit|constexpr|consteval|friend|template\\s*<[^>]*>|__attribute__\\(\\([^)]*\\)\\)';
const DART_MODS = 'static|external|abstract|final|const|factory|late';

function go(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^func\s+(\([^)]*\)\s*)?([A-Za-z_]\w*)/.exec(line))) out.push({ name: m[2], kind: m[1] ? 'method' : 'function', line: i + 1, depth: 0 });
    else if ((m = /^(?:type\s+|\s+)([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+(struct|interface)\b/.exec(line))) out.push({ name: m[1], kind: m[2] === 'struct' ? 'class' : 'type', line: i + 1, depth: 0 });
    else if ((m = /^type\s+([A-Za-z_]\w*)\b(?!\s*\()/.exec(line))) out.push({ name: m[1], kind: 'type', line: i + 1, depth: 0 });
  });
  return out;
}

const RUST_VIS = '(?:pub(?:\\([^)]*\\))?\\s+)?';
const rust = first(
  rule(new RegExp(`^\\s*${RUST_VIS}(?:unsafe\\s+)?impl(?:\\s*<.*?>)?\\s+([^{]+?)\\s*(?:where\\b.*)?\\{?\\s*$`), 'class', true),
  rule(new RegExp(`^\\s*${RUST_VIS}(?:unsafe\\s+)?trait\\s+(\\w+)`), 'type', true),
  rule(new RegExp(`^\\s*${RUST_VIS}mod\\s+(\\w+)`), 'module', true),
  rule(new RegExp(`^\\s*${RUST_VIS}(?:struct|union)\\s+(\\w+)`), 'class'),
  rule(new RegExp(`^\\s*${RUST_VIS}(?:enum|type)\\s+(\\w+)`), 'type'),
  rule(new RegExp(`^\\s*${RUST_VIS}(?:(?:const|async|unsafe|extern(?:\\s+"[^"]*")?)\\s+)*fn\\s+(\\w+)`), 'function'),
  rule(/^\s*macro_rules!\s*(\w+)/, 'function'),
);
// Lifetimes ('a) look like an unclosed quote.
const rustStrip = (line: string) => line.replace(/'[A-Za-z_]\w*(?!')/g, '');

const java = first(
  rule(new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:${JAVA_MODS})\\s+)*(?:class|interface|enum|record|@interface)\\s+(\\w+)`), 'class', true),
  typedFunction(`@\\w+(?:\\([^)]*\\))?|${JAVA_MODS}`),
);

const csharp = first(
  rule(/^\s*namespace\s+([\w.]+)/, 'module', true),
  rule(new RegExp(`^\\s*(?:\\[[^\\]]*\\]\\s*)*(?:(?:${CSHARP_MODS})\\s+)*(?:class|interface|struct|enum|record(?:\\s+(?:class|struct))?)\\s+(\\w+)`), 'class', true),
  typedFunction(`\\[[^\\]]*\\]|${CSHARP_MODS}`),
);

const KOTLIN_MODS = 'public|private|internal|protected|open|abstract|sealed|data|enum|annotation|inner|value|override|final|inline|suspend|operator|infix|tailrec|external|expect|actual';
const kotlin = first(
  rule(new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:${KOTLIN_MODS}|companion)\\s+)*(?:class|interface|object)\\s+(\\w+)`), 'class', true),
  rule(/^\s*(?:(?:public|private|internal|protected)\s+)?companion\s+(object)\b/, 'class', true),
  rule(new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:${KOTLIN_MODS})\\s+)*fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.<>?]+\\.)?(\\w+)\\s*\\(`), 'function'),
  rule(/^\s*(?:(?:public|private|internal)\s+)?typealias\s+(\w+)/, 'type'),
);

const SWIFT_MODS = 'public|private|fileprivate|internal|open|final|indirect|static|class|override|mutating|nonmutating|convenience|required|dynamic|@\\w+(?:\\([^)]*\\))?';
const swift = first(
  rule(new RegExp(`^\\s*(?:(?:${SWIFT_MODS})\\s+)*(?:class|struct|enum|extension|actor)\\s+([\\w.]+)`), 'class', true),
  rule(new RegExp(`^\\s*(?:(?:${SWIFT_MODS})\\s+)*protocol\\s+(\\w+)`), 'type', true),
  rule(new RegExp(`^\\s*(?:(?:${SWIFT_MODS})\\s+)*func\\s+([^\\s(<]+)`), 'function'),
  rule(new RegExp(`^\\s*(?:(?:${SWIFT_MODS})\\s+)*(init[?!]?|deinit)\\s*[({]`), 'function'),
  rule(new RegExp(`^\\s*(?:(?:${SWIFT_MODS})\\s+)*typealias\\s+(\\w+)`), 'type'),
);

const dart = first(
  rule(/^\s*(?:(?:abstract|base|final|interface|sealed|mixin)\s+)*(?:class|mixin|extension|enum)\s+(\w+)/, 'class', true),
  rule(/^\s*typedef\s+(\w+)/, 'type'),
  (line, inside) => {
    const m = new RegExp(`^\\s*(?:@\\w+\\s+)*(?:(?:${DART_MODS})\\s+)*((?:[\\w.]+(?:<[^()]*?>)?\\??\\s+)?)(\\w+)\\s*(?:<[^()]*>)?\\s*\\(`).exec(line);
    if (!m || NOT_NAMES.has(m[2]) || (m[1] && !typed(m[1]))) return null;
    // Untyped only where declarations are all there is: the top level and class bodies.
    if (!m[1] && /;\s*$/.test(line)) return null;
    return { name: m[2], kind: 'function' };
  },
);

const C_TYPES = (cpp: boolean) =>
  first(
    ...(cpp ? [rule(/^\s*(?:inline\s+)?namespace\s+([\w:]+)/, 'module', true)] : []),
    (line) => {
      const m = /^\s*(?:typedef\s+)?(?:template\s*<[^>]*>\s*)?(struct|class|union|enum(?:\s+class)?)\s+(?:\[\[[^\]]*\]\]\s*)?(?:\w+_API\s+)?([A-Za-z_]\w*)\b(?!\s*[*&(;]|\s+\w+\s*[;=(])/.exec(line);
      if (!m || (m[1] === 'class' && !cpp)) return null;
      return { name: m[2], kind: m[1].startsWith('enum') ? 'type' : 'class', container: m[1] !== 'union' && !m[1].startsWith('enum') };
    },
    typedFunction(CPP_MODS),
  );

function objectiveC(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let inside = false;
  const c = C_TYPES(false);
  lines.forEach((line, i) => {
    let m: RegExpExecArray | null;
    if ((m = /^\s*@(interface|implementation|protocol)\s+(\w+)(?:\s*\(\s*(\w*)\s*\))?/.exec(line))) {
      out.push({ name: m[3] !== undefined ? `${m[2]} (${m[3]})` : m[2], kind: m[1] === 'protocol' ? 'type' : 'class', line: i + 1, depth: 0 });
      inside = !/;\s*$/.test(line);
    } else if (/^\s*@end\b/.test(line)) inside = false;
    else if ((m = /^\s*[-+]\s*\([^)]*\)\s*(\w+)(?:\s*:)?/.exec(line))) out.push({ name: m[1], kind: 'method', line: i + 1, depth: inside ? 1 : 0 });
    else if (!inside && !/^\s/.test(line)) {
      const f = c(line, undefined);
      if (f && f.kind === 'function') out.push({ name: f.name, kind: 'function', line: i + 1, depth: 0 });
    }
  });
  return out;
}

// Line-based languages: every match is a top-level symbol.
function lineRules(lines: string[], rules: [RegExp, SymbolKind][], name: (m: RegExpExecArray) => string = (m) => m[1]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  lines.forEach((line, i) => {
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (m) {
        out.push({ name: name(m), kind, line: i + 1, depth: 0 });
        break;
      }
    }
  });
  return out;
}

function yaml(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  let block = -1;
  lines.forEach((line, i) => {
    // Skip the body of a multi-line string (key: | or >), which can hold anything.
    if (block >= 0) {
      if (!line.trim() || /^\s/.test(line)) return;
      block = -1;
    }
    const m = /^(?:"([^"]+)"|'([^']+)'|([^\s#\-?:&*!|>%@`{[,"'][^:#]*?))\s*:(?:\s+(.*))?$/.exec(line);
    if (!m) return;
    out.push({ name: m[1] ?? m[2] ?? m[3], kind: 'variable', line: i + 1, depth: 0 });
    if (m[4] && /^[|>][-+0-9]*\s*(?:#.*)?$/.test(m[4])) block = 0;
  });
  return out;
}

function makefile(lines: string[]): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  lines.forEach((line, i) => {
    if (/^\t/.test(line)) return;
    const m = /^([^\s:#=][^:#=]*?)\s*::?(?!=)/.exec(line);
    if (!m || /^\.[A-Z_]+$/.test(m[1]) || /^(?:-?include|ifn?eq|ifn?def|else|endif|define|export)\b/.test(m[1])) return;
    out.push({ name: m[1], kind: 'function', line: i + 1, depth: 0 });
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
    case 'go':
      return go(lines);
    case 'rust':
      return braces(lines, rust, rustStrip);
    case 'java':
      return braces(lines, java);
    case 'csharp':
      return braces(lines, csharp);
    case 'kotlin':
      return braces(lines, kotlin);
    case 'swift':
      return braces(lines, swift);
    case 'dart':
      return braces(lines, dart);
    case 'c':
      return braces(lines, C_TYPES(false));
    case 'cpp':
      return braces(lines, C_TYPES(true));
    case 'objectivec':
      return objectiveC(lines);
    case 'shell':
      return lineRules(lines, [
        [/^\s*function\s+([\w.:-]+)/, 'function'],
        [/^\s*([\w.:-]+)\s*\(\s*\)/, 'function'],
      ]);
    case 'powershell':
      return lineRules(lines, [
        [/^\s*function\s+([\w-]+)/i, 'function'],
        [/^\s*class\s+(\w+)/i, 'class'],
      ]);
    case 'makefile':
      return makefile(lines);
    case 'yaml':
      return yaml(lines);
    case 'toml':
    case 'ini':
      return lineRules(lines, [[/^\s*\[\[?\s*([^\]]+?)\s*\]\]?/, 'module']]);
    case 'env':
      return lineRules(lines, [[/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/, 'variable']]);
    case 'dockerfile':
      return lineRules(lines, [[/^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/i, 'module']], (m) => m[2] ?? m[1]);
    default:
      return [];
  }
}
