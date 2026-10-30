import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import type { Extension } from '@codemirror/state';

import type { Language } from '../../src/features/editor/bridge';

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
    case 'markdown':
      return markdown();
    case 'lua':
      return StreamLanguage.define(lua);
    case 'ruby':
      return StreamLanguage.define(ruby);
    case 'php':
      // Plain PHP files: code from the start, not inside <?php in HTML.
      return php({ plain: false });
    case 'sql':
      return sql();
    default:
      return [];
  }
}
