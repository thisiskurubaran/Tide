// Building blocks for the store images. Each template composes these into
// HTML strings. window.FEATHER (the Feather glyph map) is injected by build.js.
(function () {
  const T = (window.Tide = {});
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  T.esc = esc;

  // Feather icon, the set Tide uses (@expo/vector-icons/Feather).
  T.icon = (name, style = '', cls = '') => {
    const code = (window.FEATHER || {})[name];
    if (!code) throw new Error(`Unknown Feather icon: ${name}`);
    return `<i class="fe ${cls}" style="${style}">${String.fromCodePoint(code)}</i>`;
  };
  const I = T.icon;

  // Tide's app icon (assets/brand/tide-mark.svg), inline.
  T.mark = (size, id = 'm' + Math.random().toString(36).slice(2, 7)) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b5bdb"/><stop offset="1" stop-color="#0e1a4d"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#${id})"/><path d="M7.5 9.5L12.5 14.5L7.5 19.5" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.5 19.5c1.66-2.13 2.94-2.13 4.6 0s2.94 2.13 4.6 0" fill="none" stroke="#d4ddff" stroke-width="3" stroke-linecap="round"/></svg>`;

  // File-type badge (src/components/FileBadge.tsx).
  const BADGES = [
    [/\.(html?)$/i, '<>', '#f0835f'],
    [/\.(css|scss)$/i, '#', '#6fb3ff'],
    [/\.(tsx?)$/i, 'TS', '#6f9dff'],
    [/\.(jsx?|mjs)$/i, 'JS', '#e8d44d'],
    [/\.(json)$/i, '{}', '#e8b04f'],
    [/\.(md)$/i, 'M↓', '#a3aaa7'],
    [/\.py$/i, 'Py', '#3fc095'],
    [/\.(sql|sqlite3?|db)$/i, 'DB', '#4fc6d6'],
    [/\.http$/i, '→', '#4fc6d6'],
    [/\.(ya?ml|toml|env)$|^\.env/i, '⚙', '#a3aaa7'],
    [/\.(png|svg)$/i, '◩', '#c49bff'],
  ];
  T.badge = (name, size = 14) => {
    const hit = BADGES.find(([re]) => re.test(name));
    const [, text, color] = hit || [null, '·', '#93aaa9'];
    const fs = text.length > 2 ? size * 0.42 : size * 0.55;
    return `<span class="badge" style="width:${size + 2}px;height:${size - 2}px;background:${color}22;color:${color};font-size:${fs}px">${esc(text)}</span>`;
  };

  // ---------- Syntax highlighting, in Tide's editor colors ----------
  const JS_KW = 'const let var function return if else for of in while await async import from export default new class extends throw try catch finally typeof instanceof interface type implements enum as switch case break continue null undefined true false this void';
  const PY_KW = 'def return if elif else for in while import from as with class None True False await async try except finally raise not and or is lambda yield pass self';
  const kwSet = (s) => new Set(s.split(' '));
  const RULES = {
    js: { kw: kwSet(JS_KW), comment: /\/\/.*|\/\*[\s\S]*?\*\//y, str: /`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/y },
    py: { kw: kwSet(PY_KW), comment: /#.*/y, str: /f?"""[\s\S]*?"""|f?'(?:\\.|[^'])*'|f?"(?:\\.|[^"])*"/y },
  };
  function hlCode(src, lang) {
    if (lang === 'ts') lang = 'js';
    if (lang === 'html') return hlHtml(src);
    if (lang === 'css') return hlCss(src);
    if (lang === 'json') return hlJson(src);
    if (lang === 'http') return hlHttp(src);
    if (lang === 'plain') return esc(src);
    const r = RULES[lang];
    let out = '';
    let i = 0;
    const at = (re) => { re.lastIndex = i; const m = re.exec(src); return m ? m[0] : null; };
    let prevWord = '';
    while (i < src.length) {
      let m;
      if ((m = at(r.comment))) { out += `<span class="c">${esc(m)}</span>`; i += m.length; continue; }
      if ((m = at(r.str))) { out += `<span class="s">${esc(m)}</span>`; i += m.length; continue; }
      if ((m = at(/\d[\d_.]*(?:e\d+)?/y))) { out += `<span class="n">${m}</span>`; i += m.length; continue; }
      if (lang === 'py' && (m = at(/@[\w.]+/y))) { out += `<span class="f">${esc(m)}</span>`; i += m.length; continue; }
      if ((m = at(/[A-Za-z_$][\w$]*/y))) {
        const next = src.slice(i + m.length).match(/^\s*(\(|=\s*(async\s*)?\()/);
        let cls = 'v';
        if (r.kw.has(m)) cls = 'k';
        else if (prevWord === 'function' || prevWord === 'def' || (next && next[1] === '(')) cls = 'f';
        else if (/^[A-Z][a-z]/.test(m) || prevWord === 'class' || prevWord === 'interface' || prevWord === 'type') cls = 't';
        out += `<span class="${cls}">${esc(m)}</span>`;
        prevWord = m;
        i += m.length;
        continue;
      }
      if ((m = at(/\s+/y))) { out += m; i += m.length; continue; }
      const ch = src[i];
      out += `<span class="p">${esc(ch)}</span>`;
      i++;
    }
    return out;
  }
  function hlHtml(src) {
    return esc(src)
      .replace(/(&lt;\/?)([a-z0-9-]+)((?:\s+[a-z-:]+(?:=&quot;[^&]*&quot;|="[^"]*")?)*)(\s*\/?&gt;)/gi, (all, open, name, attrs, close) => {
        const a = attrs.replace(/([a-z-:]+)(=)("[^"]*")/gi, '<span class="at">$1</span><span class="p">$2</span><span class="s">$3</span>');
        return `<span class="p">${open}</span><span class="tg">${name}</span>${a}<span class="p">${close}</span>`;
      })
      .replace(/(&lt;!--.*?--&gt;)/g, '<span class="c">$1</span>');
  }
  function hlCss(src) {
    return src
      .split('\n')
      .map((line) => {
        if (/^\s*\/\*/.test(line)) return `<span class="c">${esc(line)}</span>`;
        const prop = line.match(/^(\s*)([a-z-]+)(\s*:\s*)(.*?)(;?)$/);
        if (prop && !/[{}]/.test(line)) {
          const val = esc(prop[4])
            .replace(/(#[0-9a-f]{3,8}|\b\d[\d.]*(?:px|rem|em|%|s|fr|vh|vw)?\b)/gi, '<span class="n">$1</span>')
            .replace(/\b(var|rgba?|linear-gradient|calc|repeat|minmax)\(/g, '<span class="f">$1</span>(');
          return `${prop[1]}<span class="v">${prop[2]}</span><span class="p">${esc(prop[3])}</span>${val}<span class="p">${prop[5]}</span>`;
        }
        return esc(line).replace(/^(\s*)([^{]+?)(\s*\{)/, '$1<span class="t">$2</span><span class="p">$3</span>').replace(/^(\s*)(\})/, '$1<span class="p">$2</span>');
      })
      .join('\n');
  }
  function hlJson(src) {
    return src.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d[\d.]*\b|\btrue\b|\bfalse\b|\bnull\b)|([^"\d\w]+|\w+)/g, (all, str, colon, lit, other) => {
      if (str) return colon ? `<span class="v">${esc(str)}</span><span class="p">${colon}</span>` : `<span class="s">${esc(str)}</span>`;
      if (lit) return `<span class="n">${lit}</span>`;
      return /^[\s]+$/.test(other) ? other : `<span class="p">${esc(other)}</span>`;
    });
  }
  function hlHttp(src) {
    return src
      .split('\n')
      .map((line) => {
        if (/^###/.test(line)) return `<span class="c">${esc(line)}</span>`;
        if (/^#/.test(line)) return `<span class="c">${esc(line)}</span>`;
        if (/^@/.test(line)) return esc(line).replace(/^(@[\w]+)(\s*=\s*)(.*)$/, '<span class="t">$1</span><span class="p">$2</span><span class="s">$3</span>');
        const req = line.match(/^(GET|POST|PUT|PATCH|DELETE)(\s+)(.*)$/);
        if (req) return `<span class="k">${req[1]}</span>${req[2]}${esc(req[3]).replace(/(\{\{\w+\}\})/g, '<span class="t">$1</span>')}`;
        const hdr = line.match(/^([A-Za-z-]+)(:\s*)(.*)$/);
        if (hdr) return `<span class="f">${hdr[1]}</span><span class="p">${esc(hdr[2])}</span>${esc(hdr[3]).replace(/(\{\{\w+\}\})/g, '<span class="t">$1</span>')}`;
        return hlJson(line);
      })
      .join('\n');
  }
  T.hl = hlCode;

  // ---------- iOS status bar ----------
  const signal = (c) => `<svg width="19" height="12" viewBox="0 0 19 12"><rect x="0" y="8" width="3.2" height="4" rx="1" fill="${c}"/><rect x="5" y="5.5" width="3.2" height="6.5" rx="1" fill="${c}"/><rect x="10" y="3" width="3.2" height="9" rx="1" fill="${c}"/><rect x="15" y="0" width="3.2" height="12" rx="1" fill="${c}"/></svg>`;
  const wifi = (c) => `<svg width="17" height="12" viewBox="0 0 17 12"><path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2C14 1.6 11.4.5 8.5.5S3 1.6 1 3.6l1.2 1.2C3.9 3.2 6.1 2.3 8.5 2.3z" fill="${c}"/><path d="M8.5 5.8c1.4 0 2.7.5 3.7 1.4l1.2-1.2C12.1 4.8 10.4 4 8.5 4S4.9 4.8 3.6 6l1.2 1.2c1-.9 2.3-1.4 3.7-1.4z" fill="${c}"/><path d="M8.5 9.2c.5 0 1 .2 1.3.5L8.5 11.5 7.2 9.7c.3-.3.8-.5 1.3-.5z" fill="${c}"/></svg>`;
  const battery = (c) => `<svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="${c}" stroke-opacity="0.4"/><rect x="2" y="2" width="20" height="9" rx="2.5" fill="${c}"/><path d="M25 4.3v4.4c.9-.3 1.5-1.2 1.5-2.2s-.6-1.9-1.5-2.2z" fill="${c}" fill-opacity="0.45"/></svg>`;
  T.iosStatus = ({ pad = false } = {}) =>
    `<div class="ios-status ${pad ? 'pad' : ''}"><span>9:41</span><span class="glyphs">${signal('#eaf3f2')}${wifi('#eaf3f2')}${battery('#eaf3f2')}</span></div>`;

  // ---------- Device frames ----------
  // A phone at `scale`, its top-left corner at (x, y) in canvas pixels.
  T.phone = (screen, { x, y, scale = 1, style = '' }) =>
    `<div class="device phone" style="left:${x}px;top:${y}px;transform:scale(${scale});${style}"><div class="screen">${T.iosStatus()}<div class="island"></div>${screen}<div class="home-ind"></div></div></div>`;
  T.PHONE_W = 426;
  T.PHONE_H = 898;
  // An iPad with a screen of w×h points (portrait or landscape).
  T.ipad = (screen, { x, y, scale = 1, w = 900, h = 1200, style = '' }) => {
    const cam = w < h ? `left:50%;top:5px;transform:translateX(-50%)` : `top:50%;left:5px;transform:translateY(-50%)`;
    return `<div class="device ipad" style="left:${x}px;top:${y}px;transform:scale(${scale});${style}"><span class="camera" style="${cam}"></span><div class="screen" style="width:${w}px;height:${h}px">${T.iosStatus({ pad: true })}${screen}<div class="home-ind" style="width:${w > h ? 260 : 200}px;bottom:7px"></div></div></div>`;
  };

  // ---------- Tide UI ----------
  T.header = ({ project, branch = 'main', changed = 0, running = false, eye = false }) =>
    `<div class="app-header">
      <div class="icon-btn">${I('chevron-left', 'font-size:24px')}</div>
      <div class="title-box"><div class="title">${esc(project)}</div><div class="sub">${I('git-branch')}<span>${esc(branch)}${changed ? ` · ${changed} changed` : ''}</span></div></div>
      ${eye ? `<div class="icon-btn">${I(eye === 'code' ? 'code' : 'eye')}</div>` : ''}
      <div class="run-btn ${running ? 'stop' : ''}">${I(running ? 'square' : 'play')}<span>${running ? 'Stop' : 'Run'}</span></div>
      <div class="icon-btn">${I('command')}</div>
    </div>`;

  // The wave that rolls under the header while code runs.
  T.wave = ({ state = 'idle' } = {}) => {
    const color = state === 'success' ? '#4ade80' : state === 'error' ? '#fb7185' : '#2dd4bf';
    const op = state === 'idle' ? 0.35 : 0.95;
    let d = 'M0 3';
    for (let x = 0; x < 1300; x += 24) d += ` q6 -2.6 12 0 t12 0`;
    return `<div class="wave-track"><svg viewBox="0 0 1300 6" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-opacity="${op}" stroke-width="1.6"/></svg></div>`;
  };

  T.tabs = (tabs) =>
    `<div class="tabbar">${tabs
      .map((t) => {
        const name = t.path.split('/').pop();
        const folder = t.on && t.path.includes('/') ? t.path.slice(0, t.path.lastIndexOf('/') + 1) : '';
        return `<div class="tab ${t.on ? 'on' : ''}">${T.badge(name)}<span>${folder ? `<span class="folder">${esc(folder)}</span>` : ''}${esc(name)}</span>${t.dirty ? '<span class="dirty"></span>' : `<span class="x">${I('x')}</span>`}</div>`;
      })
      .join('')}</div>`;

  T.crumbs = (parts, symbol) =>
    `<div class="crumbs">${parts.map((p) => `<span>${esc(p)}</span>`).join(I('chevron-right'))}${symbol ? `${I('chevron-right')}<span class="sym"><i class="k">ƒ</i>${esc(symbol)}</span>` : ''}</div>`;

  // The code editor. opts: lang, start, active (line), caret (column on the
  // active line), diags ({line: [severity, message, [from, to]]}), ghost
  // ({line, text}), sel (lines), fontSize, lineHeight.
  T.editor = (code, o = {}) => {
    const lang = o.lang || 'js';
    const start = o.start || 1;
    const raw = code.replace(/^\n/, '').replace(/\s+$/, '').split('\n');
    const lines = raw.map((l, idx) => {
      const n = start + idx;
      let html;
      const d = o.diags && o.diags[n];
      if (o.caret && o.active === n) {
        html = hlCode(l.slice(0, o.caret), lang) + '<span class="caret"></span>' + (o.ghost && o.ghost.line === n ? `<span class="ghost">${esc(o.ghost.text)}</span>` : '') + hlCode(l.slice(o.caret), lang);
      } else if (d && d[2]) {
        const [a, b] = d[2];
        html = hlCode(l.slice(0, a), lang) + `<span class="squiggle ${d[0] === 'warning' ? 'warn' : ''}">${hlCode(l.slice(a, b), lang)}</span>` + hlCode(l.slice(b), lang);
      } else html = hlCode(l, lang) || ' ';
      if (d) html += `<span class="diag ${d[0]}">${d[0] === 'error' ? '✕' : '▲'} ${esc(d[1])}</span>`;
      const cls = o.active === n ? 'on' : o.sel && o.sel.includes(n) ? 'sel' : '';
      return { n, html, cls };
    });
    const style = `${o.fontSize ? `font-size:${o.fontSize}px;` : ''}${o.lineHeight ? `line-height:${o.lineHeight}px;` : ''}${o.style || ''}`;
    const w = o.widgets || {};
    const gap = (n) => (w[n] ? `<div style="height:${w[n].height}px"></div>` : '');
    return `<div class="editor" style="${style}"><div class="gutter">${lines.map((l) => `<div class="${l.cls === 'on' ? 'on' : ''}">${l.n}</div>${gap(l.n)}`).join('')}</div><div class="lines">${lines
      .map((l) => `<div class="ln ${l.cls}">${l.html}</div>${w[l.n] ? `<div style="height:${w[l.n].height}px;position:relative">${w[l.n].html}</div>` : ''}`)
      .join('')}</div>${o.overlay || ''}</div>`;
  };

  T.terminal = ({ out, height = 300, tabs = 1, problems = 0, port = null, mode = 'Local', style = '' }) =>
    `<div class="term" style="height:${height}px;${style}">
      <div class="grab"><span></span></div>
      <div class="thead">
        ${Array.from({ length: tabs }, (_, i) => `<div class="ttab ${i === 0 ? 'on' : ''}">${I('terminal')}<span>${i + 1}</span>${i === 0 && tabs > 1 ? I('x', 'color:#93aaa9') : ''}</div>`).join('')}
        <div class="icon-btn muted" style="width:30px;height:30px;font-size:16px">${I('plus')}</div>
        ${port ? `<span class="port">:${port}</span>` : ''}
        <span style="flex:1"></span>
        ${problems ? `<span class="probs">${I('alert-circle', 'font-size:11px')}${problems}</span>` : ''}
        <div class="icon-btn muted" style="width:30px;height:30px;font-size:15px">${I('search')}</div>
        <div class="seg"><span class="${mode === 'Local' ? 'on' : ''}">Local</span><span class="${mode === 'Remote' ? 'on' : ''}">Remote</span></div>
        <div class="icon-btn muted" style="width:30px;height:30px;font-size:17px">${I('chevron-down')}</div>
      </div>
      <div class="out">${out}</div>
    </div>`;

  T.prompt = (project, where = '~') => `<span class="tb">${esc(project)}</span> <span class="tc">${esc(where)}</span> $ `;

  T.statusBar = ({ branch = 'main', changed = 0, errors = 0, warnings = 0, ln, col, lang, running = false, mode = 'Local' }) =>
    `<div class="statusbar">
      <span class="it">${I('git-branch')}${esc(branch)}${changed ? ` · ${changed}` : ''}</span>
      <span class="it"><span class="${errors ? 'err' : ''}">${I('x-circle')}</span><span class="${errors ? 'err' : ''}">${errors}</span><span class="${warnings ? 'warn' : ''}" style="margin-left:4px">${I('alert-triangle')}</span><span class="${warnings ? 'warn' : ''}">${warnings}</span></span>
      <span class="sp"></span>
      ${running ? '<span class="it" style="color:#4ade80"><span class="run-dot"></span>Running</span>' : ''}
      ${ln ? `<span class="it">Ln ${ln}, Col ${col}</span>` : ''}
      ${lang ? `<span class="it">${esc(lang)}</span>` : ''}
      <span class="it brand">${I(mode === 'Local' ? 'smartphone' : 'server')}${mode}</span>
    </div>`;

  const ACTIVITIES = [
    ['files', 'Files', 'file'],
    ['search', 'Search', 'search'],
    ['git', 'Git', 'git-branch'],
    ['terminal', 'Terminal', 'terminal'],
    ['problems', 'Problems', 'alert-circle'],
    ['more', 'More', 'grid'],
  ];
  T.activity = ({ active = null, git = 0, problems = 0 } = {}) =>
    `<div class="activity">${ACTIVITIES.map(([id, label, icon]) => {
      const b = id === 'git' && git ? `<span class="bdg">${git}</span>` : id === 'problems' && problems ? `<span class="bdg alert">${problems}</span>` : '';
      return `<div class="ai ${active === id ? 'on' : ''}"><span class="ic">${I(icon)}${b}</span><span class="l">${label}</span></div>`;
    }).join('')}</div>`;
  T.rail = ({ active = 'files', git = 0, problems = 0 } = {}) =>
    `<div class="rail">${ACTIVITIES.map(([id, , icon]) => {
      const b = id === 'git' && git ? `<span class="bdg" style="top:2px;left:22px">${git}</span>` : id === 'problems' && problems ? `<span class="bdg alert" style="top:2px;left:22px">${problems}</span>` : '';
      return `<div class="ri ${active === id ? 'on' : ''}">${I(icon)}${b}</div>`;
    }).join('')}</div>`;

  // nodes: [depth, name, {dir, open, on, git: 'M'|'U'}]
  T.files = (nodes, { width = 220, title = 'weather-cli' } = {}) =>
    `<div class="files" style="width:${width}px"><div class="fhead"><span>${esc(title)}</span><span>${I('file-plus')}${I('folder-plus')}</span></div><div class="filter">${I('filter', 'font-size:12px')}Filter files</div><div style="padding-top:4px">${nodes
      .map(([depth, name, f = {}]) => {
        const cls = [f.on ? 'on' : '', f.git === 'M' ? 'mod' : f.git === 'U' ? 'new' : ''].join(' ');
        const icon = f.dir ? `<span class="chev">${I(f.open ? 'chevron-down' : 'chevron-right')}</span><span class="dir">${I('folder')}</span>` : `<span class="chev"></span>${T.badge(name)}`;
        const g = f.git ? `<span class="g" style="color:${f.git === 'M' ? '#fbbf24' : '#4ade80'}">${f.git}</span>` : '';
        return `<div class="node ${cls}" style="padding-left:${10 + depth * 14}px">${icon}<span class="nm">${esc(name)}</span>${g}</div>`;
      })
      .join('')}</div></div>`;

  T.keybar = (keys) =>
    `<div class="keybar">${keys
      .map((k) => {
        if (k.startsWith('i:')) return `<span class="kk ${k === 'i:move' ? 'acc' : ''}">${I(k.slice(2))}</span>`;
        return `<span class="kk ${k.length > 2 ? 'txt' : ''}">${esc(k)}</span>`;
      })
      .join('')}</div>`;

  T.keyboard = () => {
    const row = (keys, extra = '') => `<div class="row" ${extra}>${keys.map((k) => `<span class="key">${k}</span>`).join('')}</div>`;
    return `<div class="kbd">
      ${row('qwertyuiop'.split(''))}
      ${row('asdfghjkl'.split(''), 'style="padding:0 18px"')}
      <div class="row"><span class="key fn w">⇧</span>${'zxcvbnm'.split('').map((k) => `<span class="key">${k}</span>`).join('')}<span class="key fn w">⌫</span></div>
      <div class="row"><span class="key fn w" style="flex-basis:92px">123</span><span class="key space">space</span><span class="key ret">return</span></div>
    </div>`;
  };

  // ---------- Page layouts ----------
  const copy = (headline, sub, { top, size, subSize, width, align = 'center', left = 0 }) =>
    `<div class="copy" style="top:${top}px;text-align:${align};${align === 'left' ? `left:${left}px;right:auto;` : ''}">
      <h1 class="headline" style="font-size:${size}px">${headline}</h1>
      <p class="subhead" style="font-size:${subSize}px;max-width:${width}px;margin:${Math.round(size * 0.34)}px ${align === 'left' ? '0' : 'auto'} 0">${sub}</p>
    </div>`;
  T.copy = copy;

  // iPhone 1206×2622 (402×874 at 3x): headline, subhead, then the phone.
  T.iphoneShot = ({ headline, sub, screen, extra = '', phoneTop = 192, bottom = 22, glow = 'teal' }) => {
    const scale = (874 - phoneTop - bottom) / T.PHONE_H;
    const x = (402 - T.PHONE_W * scale) / 2;
    const g = glow === 'blue' ? 'rgba(59,91,219,0.45)' : 'rgba(45,212,191,0.28)';
    return `<div class="canvas">
      <div class="glow" style="width:420px;height:420px;left:-10px;top:${phoneTop + 120}px;background:${g}"></div>
      ${copy(headline, sub, { top: 46, size: 35, subSize: 15, width: 330 })}
      ${T.phone(screen, { x, y: phoneTop, scale })}
      ${extra}
    </div>`;
  };

  // iPad 2064×2752 (1032×1376 at 2x): headline, subhead, then a portrait iPad.
  T.ipadShot = ({ headline, sub, screen, extra = '', top = 250, bottom = 40, w = 900, h = 1200 }) => {
    const scale = (1376 - top - bottom) / (h + 36);
    const x = (1032 - (w + 36) * scale) / 2;
    return `<div class="canvas">
      <div class="glow" style="width:900px;height:700px;left:66px;top:${top + 200}px;background:rgba(59,91,219,0.35)"></div>
      ${copy(headline, sub, { top: 70, size: 58, subSize: 22, width: 720 })}
      ${T.ipad(screen, { x, y: top, scale, w, h })}
      ${extra}
    </div>`;
  };

  T.mount = (html) => {
    document.body.innerHTML = html;
  };
})();
