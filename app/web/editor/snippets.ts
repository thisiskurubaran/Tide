// Your own snippets in the completion list.
import { Completion, CompletionContext, CompletionResult, snippetCompletion } from '@codemirror/autocomplete';

import type { Language, Snippet } from '../../src/features/editor/bridge';

// A snippet for "javascript" is offered in all the JavaScript family, and so on.
const FAMILY: Partial<Record<Language, Language[]>> = {
  javascript: ['javascript', 'jsx', 'typescript', 'tsx'],
  typescript: ['typescript', 'tsx'],
  css: ['css', 'html'],
};

export const snippetApplies = (s: Snippet, lang: Language) => !s.languages?.length || s.languages.some((l) => l === lang || FAMILY[l]?.includes(lang));

// VS Code snippet bodies ($1, ${2:name}, $0) in CodeMirror's syntax (${1}, ${2:name}, ${}).
export function toCodeMirror(body: string): string {
  return body
    .replace(/#\{/g, '#\\{')
    .replace(/\\\$/g, '\u0000')
    .replace(/\$\{0(?::([^}]*))?\}|\$0(?!\d)/g, (_, text: string | undefined) => `\${${text ?? ''}}`)
    .replace(/\$(\d+)/g, (_, n: string) => `\${${n}}`)
    .replace(/\u0000/g, '$');
}

export function snippetSource(lang: () => Language, snippets: () => Snippet[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const list = snippets().filter((s) => snippetApplies(s, lang()));
    if (!list.length) return null;
    const word = context.matchBefore(/[\w$.-]+$/);
    if (!word && !context.explicit) return null;
    const options: Completion[] = list.map((s) =>
      snippetCompletion(toCodeMirror(s.body), { label: s.prefix, detail: s.description || 'snippet', type: 'text', boost: 50 }),
    );
    return { from: word ? word.from : context.pos, options, validFor: /^[\w$.-]*$/ };
  };
}
