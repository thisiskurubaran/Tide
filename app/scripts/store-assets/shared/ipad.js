// iPad layout (ProjectScreen.tsx with wide = true): side rail, files sidebar,
// tabs and breadcrumbs, then panes, the terminal sheet and the status bar.
(function () {
  const T = window.Tide;
  T.workspace = (o) => {
    const files = o.files ? T.files(o.files, { width: o.filesWidth || 220, title: o.project }) + '<div class="ws-div"><span></span></div>' : '';
    return `<div class="ws-pad" style="display:flex;flex-direction:column;flex:1;min-height:0">
      ${T.header({ project: o.project, branch: o.branch || 'main', changed: o.changed || 0, running: o.running, eye: o.eye })}
      ${T.wave({ state: o.wave || 'idle' })}
      <div class="ws-body">
        ${T.rail({ active: o.active || 'files', git: o.changed || 0, problems: o.problems || 0 })}
        ${files}
        <div class="ws-main">
          ${o.tabs ? T.tabs(o.tabs) : ''}
          ${o.crumbs ? T.crumbs(o.crumbs[0], o.crumbs[1]) : ''}
          <div class="ws-panes">${o.panes}</div>
          ${o.terminal || ''}
        </div>
      </div>
      ${T.statusBar(o.status)}
      <div class="ws-foot"></div>
    </div>`;
  };
  T.divider = () => '<div class="ws-div"><span></span></div>';
})();
