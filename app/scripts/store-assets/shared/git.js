(function () {
  const I = Tide.icon;
  const G = (window.Git = {});
  const COLORS = { modified: '#fbbf24', new: '#4ade80', deleted: '#fb7185' };
  G.CHANGES = [
    ['lib/format.js', 'modified'],
    ['index.js', 'modified'],
    ['test/format.test.js', 'modified'],
    ['lib/units.js', 'new'],
  ];
  G.sheet = ({ branch = 'feat/units', message = 'Add --units flag with Fahrenheit output' } = {}) =>
    `<div class="sc-title"><h2>Source control</h2><span>${I('git-branch', 'font-size:12px')}${branch}</span></div>
     <div class="sc-changes">${G.CHANGES.map(([p, s]) => `<div class="sc-change">${Tide.badge(p)}<span>${p}</span><span class="st" style="color:${COLORS[s]}">${s}</span></div>`).join('')}</div>
     <div class="input sc-msg">${message}<span class="caret" style="margin-left:2px;height:15px"></span></div>
     <span class="btn outline sm">${I('cpu')}Suggest message</span>
     <div class="sc-actions"><span class="btn outline">${I('download')}Pull</span><span class="btn outline">${I('upload')}Push</span><span class="btn">${I('check')}Commit all</span></div>`;
  G.pr = () =>
    `<div class="pr-head">
       <div class="pt">Add --units flag with Fahrenheit output</div>
       <div class="meta"><span class="pr-badge" style="background:#0f2a1c;color:#4ade80">${I('git-pull-request', 'font-size:11px')}Open</span><span>you/weather-cli #42</span><span>· feat/units → main</span></div>
     </div>
     <div style="padding:12px 16px 4px"><div class="seg" style="display:inline-flex"><span>Conversation</span><span>Files</span><span class="on">Checks</span></div></div>
     <div style="padding:2px 0 6px">
       <div class="pr-check"><span style="color:#4ade80">${I('check-circle')}</span>test (node 20)<span class="sub">passed · 41s</span></div>
       <div class="pr-check"><span style="color:#4ade80">${I('check-circle')}</span>lint<span class="sub">passed · 12s</span></div>
     </div>
     <div class="pr-actions"><span class="btn outline">${I('message-square')}Comment</span><span class="btn outline">${I('check-square')}Review</span><span class="btn">${I('git-merge')}Merge</span></div>`;
})();
