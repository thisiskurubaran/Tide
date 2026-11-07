(function () {
  const I = Tide.icon;
  const D = (window.Deploy = {});
  const PROVIDERS = ['GitHub Pages', 'Netlify', 'Vercel', 'Cloudflare Pages', 'Firebase Hosting', 'Render'];
  D.screen = ({ project = 'weather-site', provider = 'Netlify', history = true } = {}) =>
    `<div class="scr-head"><div class="icon-btn">${I('chevron-left', 'font-size:24px')}</div><div class="stt"><b>Deploy</b><span>${project}</span></div></div>
     <div class="dp">
       <div class="providers">${PROVIDERS.map((p) => `<span class="chip ${p === provider ? 'on' : ''}">${p}</span>`).join('')}</div>
       <div class="field"><span class="label">Folder to publish</span><div class="input">dist</div><span class="hint">Publishes dist/ with its index.html.</span></div>
       <div class="field"><span class="label">Personal access token</span><div class="input" style="color:#93aaa9;font-family:var(--sans)">Saved in the Keychain. Type to replace it.</div><span class="hint">Kept in the Keychain and only sent to the service.</span></div>
       <div class="field"><span class="label">Deploy automatically</span><div class="providers"><span class="chip">Off</span><span class="chip">When I save</span><span class="chip on">After each commit</span></div></div>
       <span class="btn">${I('upload-cloud')}Deploy</span>
       <span class="btn outline" style="margin-top:-4px">${I('eye')}Deploy a preview of main</span>
       <div class="done">
         <div class="h">${I('check-circle')}Published</div>
         <div class="url">https://${project}.netlify.app</div>
         <div class="row"><span class="btn sm">${I('external-link')}Open</span><span class="btn sm outline">${I('copy')}Copy link</span></div>
       </div>
       ${history ? `<div class="field"><span class="label">Recent deploys</span>
         <div class="hist"><span class="ok">✓</span><div><div class="l">Netlify · after a commit</div><div class="m">just now · ${project}.netlify.app</div></div></div>
         <div class="hist"><span class="ok">✓</span><div><div class="l">Netlify preview · by hand</div><div class="m">2 hours ago</div></div></div>
         <div class="hist"><span class="ok">✓</span><div><div class="l">GitHub Pages · after saving</div><div class="m">yesterday</div></div></div>
       </div>` : ''}
     </div>`;
})();
