import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';

import fontRegular from '../../assets/fonts/JetBrainsMono-Regular.ttf';
import { FromTerminal, parseToTerminal, ToTerminal } from '../../src/features/terminal/bridge';

const FONT_FAMILY = 'JetBrains Mono';

const style = document.createElement('style');
style.textContent = `
  @font-face { font-family: '${FONT_FAMILY}'; src: url(${fontRegular}) format('truetype'); }
  html, body { margin: 0; height: 100%; overflow: hidden; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
  #terminal { position: absolute; inset: 0; padding: 6px 0 0 8px; box-sizing: border-box; }
  .xterm-viewport { scrollbar-width: none; }
`;
document.head.appendChild(style);

function post(msg: FromTerminal) {
  window.ReactNativeWebView?.postMessage(JSON.stringify(msg));
}

const term = new Terminal({
  fontFamily: `'${FONT_FAMILY}', monospace`,
  fontSize: 13,
  lineHeight: 1.2,
  // Programs print bare \n; the shell's own output does too.
  convertEol: true,
  cursorBlink: true,
  scrollback: 5000,
  allowProposedApi: false,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.loadAddon(new WebLinksAddon((_event, url) => post({ type: 'link', url })));

const container = document.getElementById('terminal')!;

async function start() {
  // Measure with the real font, otherwise the first fit uses fallback metrics.
  await document.fonts.load(`13px '${FONT_FAMILY}'`).catch(() => undefined);
  term.open(container);

  const textarea = term.textarea;
  if (textarea) {
    // Shell input, not prose: no autocorrect, capitalisation or spellcheck.
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('spellcheck', 'false');
    textarea.addEventListener('focus', () => post({ type: 'focus', focused: true }));
    textarea.addEventListener('blur', () => post({ type: 'focus', focused: false }));
  }

  fit.fit();
  term.onData((data) => post({ type: 'input', data }));
  term.onResize(({ cols, rows }) => post({ type: 'resize', cols, rows }));
  new ResizeObserver(() => fit.fit()).observe(container);
  post({ type: 'ready', cols: term.cols, rows: term.rows });
}

function handle(msg: ToTerminal) {
  switch (msg.type) {
    case 'write':
      return term.write(msg.data);
    case 'setTheme':
      term.options.theme = msg.theme;
      document.body.style.backgroundColor = msg.theme.background;
      return;
    case 'focus':
      return term.focus();
    case 'blur':
      return term.blur();
  }
}

window.tide = {
  receive(raw) {
    const msg = parseToTerminal(raw);
    if (msg) handle(msg);
  },
};

start();
