// The "Free. Every feature." grid, shared by iPhone and iPad.
(function () {
  const I = Tide.icon;
  window.Free = {
    FEATURES: [
      ['code', 'Editor', 'IntelliSense, Outline and Vim keys'],
      ['terminal', 'Terminal', 'Node.js, Python, Lua, Ruby, PHP'],
      ['cpu', 'AI', 'Agent mode, with your own key'],
      ['git-branch', 'Git', 'Commit, push, pull requests'],
      ['upload-cloud', 'Deploy', 'Five hosts, one tap'],
      ['database', 'Databases', 'SQLite, Postgres, MySQL, Redis'],
      ['server', 'SSH', 'Terminal and SFTP to your servers'],
      ['monitor', 'Preview', 'Live, as you type'],
    ],
    tile: ([icon, title, text], s = 1) =>
      `<div class="tile" style="padding:${16 * s}px;display:flex;flex-direction:column;gap:${10 * s}px">
        <div class="ti" style="width:${42 * s}px;height:${42 * s}px;font-size:${20 * s}px;border-radius:${12 * s}px">${I(icon)}</div>
        <h3 style="font-size:${18 * s}px">${title}</h3><p style="font-size:${12.5 * s}px">${text}</p></div>`,
    pill: (s = 1) =>
      `<div style="display:inline-flex;align-items:center;gap:${9 * s}px;padding:${12 * s}px ${20 * s}px;border-radius:999px;background:rgba(14,47,44,0.9);box-shadow:inset 0 0 0 1px rgba(45,212,191,0.45),0 0 40px rgba(45,212,191,0.2);font:600 ${15 * s}px/1 var(--sans);color:var(--fg)">${I('check-circle', `color:var(--brand);font-size:${16 * s}px`)}No subscription. No in-app purchases.</div>`,
  };
})();
