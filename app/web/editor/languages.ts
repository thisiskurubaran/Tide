import { cpp } from '@codemirror/lang-cpp';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { less } from '@codemirror/lang-less';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sass } from '@codemirror/lang-sass';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { foldService, StreamLanguage, type StreamParser } from '@codemirror/language';
import { csharp, dart, kotlin, objectiveC } from '@codemirror/legacy-modes/mode/clike';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import type { EditorState, Extension } from '@codemirror/state';

import type { Language } from '../../src/features/editor/bridge';

// Lines past this are not scanned for the end of an indented block.
const FOLD_SCAN = 5000;

const indentOf = (text: string) => {
  let n = 0;
  for (const ch of text) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
};

// The legacy modes have no syntax tree to fold on, so a line folds the more
// indented lines after it (a brace block's closing line stays visible).
export function indentFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  if (!line.text.trim()) return null;
  const base = indentOf(line.text);
  let end = line.number;
  const last = Math.min(state.doc.lines, line.number + FOLD_SCAN);
  for (let n = line.number + 1; n <= last; n++) {
    const text = state.doc.line(n).text;
    if (!text.trim()) continue;
    if (indentOf(text) <= base) break;
    end = n;
  }
  return end === line.number ? null : { from: line.to, to: state.doc.line(end).to };
}

const indentFold = foldService.of((state, from) => indentFoldRange(state, from));

const legacy = <T>(parser: StreamParser<T>): Extension => [StreamLanguage.define(parser), indentFold];

// Key = value files; the legacy mode has no comment token of its own.
const ini: StreamParser<unknown> = { ...properties, name: 'ini', languageData: { commentTokens: { line: '#' } } };

interface MakeState {
  recipe: boolean;
}

// Makefiles: comments, $(variables), targets, assignments and directives.
// Recipe lines (tab-indented) are left mostly plain, apart from variables.
export const makefile: StreamParser<MakeState> = {
  name: 'makefile',
  startState: () => ({ recipe: false }),
  token(stream, state) {
    if (stream.sol()) state.recipe = stream.peek() === '\t';
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\$[({]/)) {
      stream.match(/^[^)}]*[)}]?/);
      return 'variableName.special';
    }
    if (stream.match(/^\$[\w@<^?*%+]/)) return 'variableName.special';
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      let escaped = false;
      let next: string | void;
      while ((next = stream.next()) != null) {
        if (next === ch && !escaped) break;
        escaped = !escaped && next === '\\';
      }
      return 'string';
    }
    if (!state.recipe && stream.column() === stream.indentation()) {
      if (stream.match(/^(?:-?include|sinclude|ifn?eq|ifn?def|else|endif|define|endef|export|unexport|override|vpath)\b/)) return 'keyword';
      if (stream.match(/^[\w.%/$()-]+(?=\s*(?:\?|\+|::?|!)?=)/)) return 'variableName.definition';
      if (stream.match(/^[^\s:=#][^:=#]*?(?=\s*::?(?!=))/)) return 'def';
    }
    if (stream.match(/^(?:::?=|\?=|\+=|!=|=)/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

// Shared by the editor and the diff view.
export function languageExtension(lang: Language): Extension {
  switch (lang) {
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'python':
      return python();
    case 'json':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'scss':
      return sass();
    case 'less':
      return less();
    case 'markdown':
      return markdown();
    case 'lua':
      return legacy(lua);
    case 'ruby':
      return legacy(ruby);
    case 'php':
      // Plain PHP files: code from the start, not inside <?php in HTML.
      return php({ plain: false });
    case 'sql':
      return sql();
    case 'yaml':
      return yaml();
    case 'toml':
      return legacy(toml);
    case 'dockerfile':
      return legacy(dockerFile);
    case 'ini':
    case 'env':
      return legacy(ini);
    case 'shell':
      return legacy(shell);
    case 'powershell':
      return legacy(powerShell);
    case 'makefile':
      return legacy(makefile);
    case 'go':
      return go();
    case 'rust':
      return rust();
    case 'java':
      return java();
    case 'c':
    case 'cpp':
      return cpp();
    case 'objectivec':
      return legacy(objectiveC);
    case 'csharp':
      return legacy(csharp);
    case 'kotlin':
      return legacy(kotlin);
    case 'swift':
      return legacy(swift);
    case 'dart':
      return legacy(dart);
    case 'xml':
      return xml();
    default:
      return [];
  }
}
