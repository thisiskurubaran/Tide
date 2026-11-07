// VoiceOver / TalkBack in the editor: the file name on the text area, the line
// and its problems read out when the cursor moves to another line, and Next /
// Previous problem.
import { EditorState, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { adjacentProblem, lineProblems, Problem, problems, SEVERITY_LABEL } from './problems';

const LINE_DEBOUNCE_MS = 250;
const MAX_TEXT = 160;

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const problemText = (p: Problem) => `${SEVERITY_LABEL[p.severity]}: ${p.message.split('\n')[0]}`;

// "Line 13. <b>hi</a>. Error: unexpected closing tag a"
export function lineAnnouncement(state: EditorState, line: number, list: Problem[] = problems(state)): string {
  const raw = state.doc.line(line).text.trim();
  const text = raw ? (raw.length > MAX_TEXT ? raw.slice(0, MAX_TEXT) + '…' : raw) : 'blank';
  const found = lineProblems(list).get(line)?.all ?? [];
  return [`Line ${line}`, text, ...found.map(problemText)].join('. ');
}

// "Error 2 of 5, line 13: unexpected closing tag b"
export function problemAnnouncement(list: Problem[], p: Problem): string {
  return `${SEVERITY_LABEL[p.severity]} ${list.indexOf(p) + 1} of ${list.length}, line ${p.line}: ${p.message.split('\n')[0]}`;
}

let region: HTMLElement | null = null;

// A visually hidden live region; screen readers speak what is put in it.
function liveRegion(): HTMLElement {
  if (region) return region;
  region = document.createElement('div');
  region.id = 'tide-live';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  Object.assign(region.style, {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(region);
  return region;
}

export function speak(text: string) {
  const el = liveRegion();
  // Cleared first, so the same text twice is still spoken twice.
  el.textContent = '';
  setTimeout(() => (el.textContent = text), 30);
}

let quietLine: number | null = null;

// Next / Previous problem: moves the cursor and returns what to say.
export function gotoProblem(view: EditorView, direction: 1 | -1): string {
  const list = problems(view.state);
  const target = adjacentProblem(list, view.state.selection.main.head, direction);
  if (!target) return 'No problems in this file';
  // The line announcement would repeat what the app is about to say.
  quietLine = target.line;
  view.dispatch({ selection: { anchor: target.from }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) });
  return problemAnnouncement(list, target);
}

export function a11yExtension(path: () => string | null, screenReader: () => boolean): Extension[] {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastLine = -1;
  return [
    EditorView.contentAttributes.of((): Record<string, string> => {
      const file = path();
      return { 'aria-label': file ? `Code editor, ${fileName(file)}` : 'Code editor' };
    }),
    EditorView.updateListener.of((u) => {
      if (!u.selectionSet || !screenReader()) return;
      const line = u.state.doc.lineAt(u.state.selection.main.head).number;
      if (line === lastLine) return;
      lastLine = line;
      if (quietLine === line) {
        quietLine = null;
        return;
      }
      quietLine = null;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const now = u.view.state;
        speak(lineAnnouncement(now, now.doc.lineAt(now.selection.main.head).number));
      }, LINE_DEBOUNCE_MS);
    }),
  ];
}
