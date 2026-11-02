// Build-time trims for the VS Code language services in the editor bundle,
// which ships inside the app and so counts against its size:
// - the CSS and HTML data lose browser-support tables and MDN links (hover
//   can't open links, and the editor shows no compatibility info);
// - the formatters (js-beautify) are stubbed: Format & Lint uses Prettier.

const DATA = /vscode-(css|html)-languageservice[\\/]lib[\\/]esm[\\/](data|languageFacts[\\/]data)[\\/]webCustomData\.js$/;
const BEAUTIFY = /vscode-(css|html)-languageservice[\\/]lib[\\/]esm[\\/]beautify[\\/]beautify(-css|-html)?\.js$/;
const DROP = new Set(['references', 'browsers', 'baseline']);

const STUBS = {
  '': 'export function js_beautify(s) { return s; }',
  '-css': 'export function css_beautify(s) { return s; }',
  '-html': 'export function html_beautify(s) { return s; }',
};

export function trimLanguageData() {
  return {
    name: 'tide-trim-language-data',
    enforce: 'pre',
    load(id) {
      const m = BEAUTIFY.exec(id);
      return m ? STUBS[m[2] ?? ''] : null;
    },
    transform(code, id) {
      if (!DATA.test(id)) return null;
      // The files are `export const cssData = { ...JSON... };`.
      const start = code.indexOf('{');
      const end = code.lastIndexOf('}');
      const name = /export const (\w+)/.exec(code)?.[1];
      if (!name || start < 0) throw new Error(`Unexpected language data in ${id}`);
      const data = JSON.parse(code.slice(start, end + 1));
      const trimmed = JSON.stringify(data, (key, value) => (DROP.has(key) ? undefined : value));
      return { code: `export const ${name} = ${trimmed};`, map: null };
    },
  };
}
