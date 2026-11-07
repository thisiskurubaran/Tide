(function () {
  const I = Tide.icon;
  const W = (window.Preview = {});
  W.HTML = `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Weather</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <p class="city">Lisbon</p>
    <h1 class="temp">21°</h1>
    <p class="sky">Sunny, light breeze</p>
    <ul class="days">
      <li>Mon <b>24°</b></li>
      <li>Tue <b>22°</b></li>
      <li>Wed <b>19°</b></li>
    </ul>
  </main>
  <script src="app.js"></script>
</body>
</html>`;
  // The page itself, at a base font size `s` (px).
  W.page = (s = 10) =>
    `<div class="web"><div class="sun" style="width:${s * 14}px;height:${s * 14}px;right:-${s * 3}px;top:-${s * 3}px"></div>
      <div class="card" style="width:78%;padding:${s * 1.5}px ${s * 1.6}px">
        <div class="city" style="font-size:${s * 0.95}px">Lisbon</div>
        <div class="temp" style="font-size:${s * 5}px;margin:${s * 0.4}px 0">21°</div>
        <div class="sky" style="font-size:${s * 1.1}px;margin-bottom:${s}px">Sunny, light breeze</div>
        <div class="days" style="font-size:${s * 0.95}px;padding-top:${s * 0.9}px;gap:${s * 0.4}px"><div>Mon<b style="font-size:${s * 1.2}px">24°</b></div><div>Tue<b style="font-size:${s * 1.2}px">22°</b></div><div>Wed<b style="font-size:${s * 1.2}px">19°</b></div></div>
      </div></div>`;
  // A fuller page for big previews: a nav bar, the card and an hourly strip.
  W.fullPage = (s = 14) =>
    `<div class="web" style="flex-direction:column;justify-content:flex-start;gap:${s * 1.6}px;padding:${s * 1.4}px">
      <div class="sun" style="width:${s * 16}px;height:${s * 16}px;right:-${s * 4}px;top:${s * 2}px"></div>
      <div style="position:relative;width:100%;display:flex;align-items:center;justify-content:space-between;font-size:${s}px">
        <b style="font-family:'Instrument Sans';font-size:${s * 1.3}px;letter-spacing:-0.02em">☼ Weather</b>
        <span style="background:rgba(255,255,255,0.7);border-radius:999px;padding:${s * 0.5}px ${s}px;color:#9a7a60">Search a city</span>
      </div>
      <div class="card" style="width:100%;padding:${s * 1.6}px ${s * 1.7}px;margin-top:${s * 3}px">
        <div class="city" style="font-size:${s * 0.95}px">Lisbon</div>
        <div class="temp" style="font-size:${s * 5.4}px;margin:${s * 0.4}px 0">21°</div>
        <div class="sky" style="font-size:${s * 1.15}px;margin-bottom:${s * 1.1}px">Sunny, light breeze</div>
        <div class="days" style="font-size:${s * 0.95}px;padding-top:${s}px;gap:${s * 0.4}px"><div>Mon<b style="font-size:${s * 1.25}px">24°</b></div><div>Tue<b style="font-size:${s * 1.25}px">22°</b></div><div>Wed<b style="font-size:${s * 1.25}px">19°</b></div></div>
      </div>
      <div style="position:relative;width:100%;display:grid;grid-template-columns:repeat(4,1fr);gap:${s * 0.6}px">
        ${[['12:00', '21°'], ['15:00', '23°'], ['18:00', '20°'], ['21:00', '17°']].map(([t, v]) => `<div style="background:rgba(255,255,255,0.55);border-radius:${s}px;padding:${s * 0.8}px 0;text-align:center;font-size:${s * 0.85}px;color:#7a5a40">${t}<div style="font-weight:600;color:#2b1d12;font-size:${s * 1.15}px;margin-top:${s * 0.3}px">${v}</div></div>`).join('')}
      </div>
      <div style="position:relative;width:100%;background:rgba(255,255,255,0.55);border-radius:${s * 1.2}px;padding:${s * 0.6}px ${s * 1.2}px">
        <div style="font-size:${s * 0.85}px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#b4642a;padding:${s * 0.6}px 0">Next 5 days</div>
        ${[['Mon', 16, 24], ['Tue', 15, 22], ['Wed', 14, 19], ['Thu', 15, 21], ['Fri', 17, 25]].map(([d, lo, hi]) => `<div style="display:flex;align-items:center;gap:${s}px;padding:${s * 0.55}px 0;font-size:${s}px;border-top:1px solid rgba(180,100,42,0.15)"><span style="width:${s * 2.6}px;color:#7a5a40">${d}</span><span style="width:${s * 2}px;color:#9a7a60">${lo}°</span><span style="flex:1;height:${s * 0.4}px;border-radius:9px;background:rgba(180,100,42,0.12);position:relative"><span style="position:absolute;left:${(lo - 12) * 6}%;right:${(28 - hi) * 6}%;top:0;bottom:0;border-radius:9px;background:linear-gradient(90deg,#ffcf5a,#ff9a4a)"></span></span><b style="width:${s * 2}px;text-align:right;font-weight:600">${hi}°</b></div>`).join('')}
      </div>
    </div>`;
  W.window = ({ x, y, w, h, title = 'index.html', s = 10 }) =>
    `<div class="live" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <div class="bar"><span class="dot"></span><span class="lv">Live</span><span class="tt">${title}</span>${I('maximize-2')}${I('x')}</div>
      ${W.page(s)}<span class="resize"></span>
    </div>`;
})();
