// Agent mode content shared by the iPhone and iPad images.
(function () {
  const I = Tide.icon;
  const A = (window.Agent = {});

  A.diffLines = [
    [' ', 8, 'export function formatDay(day, units) {'],
    ['-', 9, '  const temp = `${day.high}° / ${day.low}°`;'],
    ['+', 9, "  const temp = units === 'imperial'"],
    ['+', 10, '    ? `${toF(day.high)}°F / ${toF(day.low)}°F`'],
    ['+', 11, '    : `${day.high}°C / ${day.low}°C`;'],
    [' ', 12, '  return `${day.name}  ${day.sky}  ${temp}`;'],
    [' ', 13, '}'],
    ['+', 14, ''],
    ['+', 15, 'const toF = (c) => Math.round(c * 9 / 5 + 32);'],
  ];

  A.diff = ({ fontSize = 12, lines = A.diffLines } = {}) =>
    `<div class="diff" style="font-size:${fontSize}px;line-height:${Math.round(fontSize * 1.65)}px">
      <div class="hh">@@ -8,4 +8,9 @@ formatDay</div>
      ${lines
        .map(([s, n, text]) => `<div class="dl ${s === '+' ? 'add' : s === '-' ? 'del' : ''}"><span class="no">${n}</span><span class="sg">${s === ' ' ? '' : s}</span><span>${Tide.hl(text, 'js') || ' '}</span></div>`)
        .join('')}
    </div>`;

  // One hunk as the review screen shows it, with Reject and Keep.
  A.hunk = ({ fontSize = 11, lines } = {}) =>
    `<div class="hunk-head">${Tide.badge('format.js', 15)}<span>lib/format.js</span><span class="st"><span style="color:#4ade80">+6</span> <span style="color:#fb7185">−1</span></span></div>
     ${A.diff({ fontSize, lines })}
     <div class="hunk-actions"><span class="sb">${I('x', 'font-size:13px')}Reject</span><span class="sb pri">${I('check', 'font-size:13px')}Keep</span></div>`;

  const step = (verb, chips, extra = '', state = 'done') =>
    `<div class="ag-step"><span class="dot">${state === 'done' ? I('check') : '<span class="ring"></span>'}</span><span>${verb}</span>${chips
      .map((c) => `<span class="ag-chip">${/\.[a-z]+$/.test(c) ? Tide.badge(c, 12) : ''}${Tide.esc(c)}</span>`)
      .join('')}${extra}</div>`;

  A.screen = ({ project, wide = false }) =>
    `<div class="ag-head"><div class="icon-btn">${I('chevron-left', 'font-size:24px')}</div><div class="title">Agent · ${project}</div><div class="icon-btn muted">${I('trash-2', 'font-size:18px')}</div></div>
     <div class="ag-body">
       <div class="ag-user">Add a --units flag so I can see Fahrenheit, and update the tests.</div>
       ${wide ? `<div class="ag-text">I'll add a units option to formatDay, read --units in index.js, and cover both in the tests.</div>` : ''}
       <div class="ag-steps">
         ${step('Read', ['format.js', 'index.js'])}
         ${step('Edited', ['format.js'], '<span class="plus">+6</span><span class="minus">−1</span>')}
         ${wide ? step('Edited', ['index.js'], '<span class="plus">+4</span><span class="minus">−1</span>') : ''}
         ${step('Edited', ['format.test.js'], '<span class="plus">+18</span>')}
         ${step('Waiting to run', ['npm test'], '', 'wait')}
       </div>
       ${wide ? '<div style="flex:1"></div>' : '<div style="flex:1"></div>'}
       <div class="ag-approve">
         <div class="q">${I('alert-triangle', 'font-size:14px')}Allow this command?</div>
         <div class="cmd"><span style="color:#93aaa9">$</span> npm test</div>
         <div class="row"><span class="btn outline">Deny</span><span class="btn outline">Allow once</span><span class="btn">Always for npm</span></div>
       </div>
     </div>
     <div style="height:12px"></div>
     <div class="ag-review">${I('git-pull-request', 'font-size:15px')}<span>Review 3 changes</span><span class="st" style="margin-left:auto"><span style="color:#4ade80">+28</span> <span style="color:#fb7185">−2</span></span>${I('chevron-right', 'font-size:15px')}</div>
     <div class="ag-foot">
       <div class="ag-input"><span>Ask for a change…</span><span class="ag-chip" style="font-family:Inter;color:#93aaa9">@ files</span><span class="send">${I('arrow-up')}</span></div>
     </div>`;

  const fileDiff = (path, add, del, body, open = true) =>
    `<div class="rv-file"><div class="rv-fh"><span class="chev">${I(open ? 'chevron-down' : 'chevron-right')}</span>${Tide.badge(path, 15)}<span>${path}</span><span class="st"><span style="color:#4ade80">+${add}</span>${del ? ` <span style="color:#fb7185">−${del}</span>` : ''}</span><span class="sp"></span><span class="sb">Reject file</span><span class="sb pri">Keep file</span></div>${open ? body : ''}</div>`;
  const hunkBody = (lines, head, fs) =>
    `<div class="diff" style="font-size:${fs}px;line-height:${Math.round(fs * 1.65)}px"><div class="hh">${head}</div>${lines
      .map(([s, n, text]) => `<div class="dl ${s === '+' ? 'add' : s === '-' ? 'del' : ''}"><span class="no">${n}</span><span class="sg">${s === ' ' ? '' : s}</span><span>${Tide.hl(text, 'js') || ' '}</span></div>`)
      .join('')}</div><div class="hunk-actions"><span class="sb">${I('x', 'font-size:12px')}Reject</span><span class="sb pri">${I('check', 'font-size:12px')}Keep</span></div>`;
  A.review = ({ fs = 12.5 } = {}) =>
    `<div class="ag-head"><div class="icon-btn">${I('chevron-left', 'font-size:24px')}</div><div style="flex:1;display:flex;flex-direction:column;gap:3px"><div class="title" style="flex:none">Review changes</div><div style="font:400 12px/1 var(--sans);color:var(--muted)">3 files · +28 −2</div></div></div>
     <div style="flex:1;min-height:0;overflow:hidden">
       <div class="rv-test">${I('check-circle', 'color:#4ade80;font-size:15px')}<code>npm test</code><span>passed · tests 4, pass 4</span></div>
       ${fileDiff('lib/format.js', 6, 1, hunkBody(A.diffLines.slice(0, 7), '@@ -8,4 +8,6 @@ formatDay', fs))}
       ${fileDiff('index.js', 4, 1, hunkBody([
         [' ', 4, "import { parseUnits } from './lib/units.js';"],
         [' ', 5, ''],
         ['-', 6, "const units = process.env.UNITS ?? 'metric';"],
         ['+', 6, 'const units = parseUnits(process.argv);'],
         ['+', 7, "const city = process.argv.find((a) => !a.startsWith('-'))"],
         ['+', 8, "  ?? 'Lisbon';"],
       ], '@@ -4,3 +4,5 @@', fs))}
       ${fileDiff('test/format.test.js', 18, 0, hunkBody([
         ['+', 14, "test('formatDay converts to Fahrenheit', () => {"],
         ['+', 15, "  const line = formatDay(mon, 'imperial');"],
         ['+', 16, '  assert.match(line, /75°F/);'],
         ['+', 17, '});'],
       ], '@@ -13,0 +14,18 @@', fs))}
     </div>
     <div class="rv-bar"><span class="btn outline">${I('rotate-ccw')}Undo all</span><span class="btn outline">${I('message-square')}Ask for changes</span><span style="flex:1"></span><span class="btn">${I('check')}Keep all</span></div>
     <div style="height:20px;background:var(--card)"></div>`;
  A.approval = () =>
    `<div class="ag-approve" style="margin:0">
       <div class="q">${I('alert-triangle', 'font-size:14px')}Allow this command?</div>
       <div class="cmd"><span style="color:#93aaa9">$</span> npm test</div>
       <div class="row"><span class="btn outline">Deny</span><span class="btn outline">Allow once</span><span class="btn">Always for npm</span></div>
     </div>`;
})();
