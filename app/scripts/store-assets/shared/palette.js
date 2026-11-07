// The command palette, with real command titles from ProjectScreen.tsx.
(function () {
  const I = Tide.icon;
  const P = (window.Palette = {});
  P.COMMANDS = [
    ['Run project (Default)', 'play', ''],
    ['Agent: ask for a change across files', 'cpu', ''],
    ['Go to symbol (outline)', 'list', '⇧⌘O'],
    ['Search in project', 'search', '⇧⌘F'],
    ['Peek definition', 'eye', '⌥F12'],
    ['Run tests', 'check-square', ''],
    ['Source control', 'git-branch', ''],
    ['Deploy…', 'upload-cloud', ''],
    ['Look up in docs (offline)', 'book', '⇧⌘D'],
    ['Show problems', 'alert-triangle', ''],
    ['Databases…', 'database', ''],
  ];
  const CHIPS = [['', 'Files'], ['>', 'Commands'], ['@', 'Symbols'], [':', 'Line'], ['#', 'Text']];
  P.card = ({ query = '>', top = 100, items = P.COMMANDS, active = 0, style = '' }) =>
    `<div class="pal" style="top:${top}px;${style}">
      <div class="in">${I('command')}<span class="q">${Tide.esc(query)}</span><span class="caret" style="margin-left:-6px"></span></div>
      <div class="chips">${CHIPS.map(([p, l]) => `<span class="${p === query.trim()[0] ? 'on' : ''}">${p ? `<b>${p}</b>` : ''}${l}</span>`).join('')}</div>
      <div style="padding:4px 0 6px">${items
        .map(([t, ic, hint], i) => `<div class="row ${i === active ? 'on' : ''}"><span class="ic">${I(ic)}</span><span>${Tide.esc(t)}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`)
        .join('')}</div>
    </div>`;
})();
