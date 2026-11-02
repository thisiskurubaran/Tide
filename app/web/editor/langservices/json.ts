// JSON from vscode-json-languageservice, with the bundled schemas.
import { getLanguageService, JSONDocument, TextDocument } from 'vscode-json-languageservice';

import { isJsonc, rankBoosts, toCompletion, toDiagnostics, toHover, uriFor } from './adapters';
import { SCHEMAS } from './schemas';
import type { LanguageService } from './types';

// No network: a $schema URL in a file is never fetched.
const service = getLanguageService({ schemaRequestService: (uri) => Promise.reject(new Error(`Schemas are not downloaded: ${uri}`)) });
service.configure({ validate: true, allowComments: false, schemas: SCHEMAS });

let last: { uri: string; text: string; doc: TextDocument; json: JSONDocument } | null = null;
function parse(path: string, text: string) {
  const uri = uriFor(path);
  if (last && last.uri === uri && last.text === text) return last;
  const doc = TextDocument.create(uri, isJsonc(path) ? 'jsonc' : 'json', 0, text);
  last = { uri, text, doc, json: service.parseJSONDocument(doc) };
  return last;
}

// .prettierrc may be YAML; only treat it as JSON when it looks like JSON.
const looksLikeJson = (path: string, text: string) => !/(^|\/)\.prettierrc$/.test(path) || /^\s*[{[]/.test(text) || !text.trim();

export const jsonService: LanguageService = {
  async complete(path, text, offset) {
    if (!looksLikeJson(path, text)) return null;
    const { doc, json } = parse(path, text);
    const list = await service.doComplete(doc, doc.positionAt(offset), json);
    if (!list?.items.length) return null;
    const boosts = rankBoosts(list.items);
    return list.items.map((item, i) => toCompletion(item, doc, offset, offset, boosts[i]));
  },
  async hover(path, text, offset) {
    if (!looksLikeJson(path, text)) return null;
    const { doc, json } = parse(path, text);
    const h = await service.doHover(doc, doc.positionAt(offset), json);
    return h ? toHover(h, doc, offset) : null;
  },
  async validate(path, text) {
    if (!looksLikeJson(path, text)) return [];
    const { doc, json } = parse(path, text);
    const jsonc = isJsonc(path);
    const items = await service.doValidation(doc, json, {
      comments: jsonc ? 'ignore' : 'error',
      trailingCommas: jsonc ? 'ignore' : 'error',
      schemaRequest: 'ignore',
    });
    return toDiagnostics(items, doc, 'json');
  },
  colors: () => [],
  presentations: () => [],
};
