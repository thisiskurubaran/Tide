// Device screens reused by the wide hero images (header and search results).
(function () {
  const T = window.Tide;
  const S = (window.Scenes = {});
  const P = 'weather-cli';

  const forecast = `
import { geocode } from './geocode.js';
import { skyFor, weekday } from './sky.js';

const BASE = 'https://api.open-meteo.com/v1';
const DAILY = 'temperature_2m_max,temperature_2m_min,weather_code';

// Daily forecast for a city, starting today.
export async function getForecast(city, days = 3) {
  const { lat, lon } = await geocode(city);
  const url = \`\${BASE}/forecast?latitude=\${lat}&longitude=\${lon}\`;
  const res = await fetch(\`\${url}&daily=\${DAILY}&forecast_days=\${days}\`);
  if (!res.ok) throw new Error(\`Forecast failed: \${res.status}\`);

  const { daily } = await res.json();
  return daily.time.map((date, i) => ({
    name: weekday(date),
    high: Math.round(daily.temperature_2m_max[i]),
    low: Math.round(daily.temperature_2m_min[i]),
    sky: skyFor(daily.weather_code[i]),
  }));
}`;

  const testOut = [
    `${T.prompt(P)}npm test`,
    `<span class="tg2">✔</span> formatDay shows highs and lows <span class="td">(1.2ms)</span>`,
    `<span class="tg2">✔</span> formatDay converts to Fahrenheit <span class="td">(0.4ms)</span>`,
    `<span class="tg2">✔</span> parseUnits rejects unknown units <span class="td">(0.3ms)</span>`,
    `<span class="tg2">✔</span> getForecast maps the daily response <span class="td">(3.8ms)</span>`,
    `<span class="tc">ℹ</span> tests 4  <span class="tg2">pass 4</span>  fail 0  <span class="td">duration 112ms</span>`,
    `${T.prompt(P)}<span class="cursor-block"></span>`,
  ].join('\n');

  const files = [
    [0, 'lib', { dir: true, open: true }],
    [1, 'forecast.js', { on: true }],
    [1, 'format.js', { git: 'M' }],
    [1, 'geocode.js'],
    [1, 'sky.js'],
    [1, 'units.js', { git: 'U' }],
    [0, 'scripts', { dir: true, open: true }],
    [1, 'avg.py'],
    [0, 'test', { dir: true, open: true }],
    [1, 'format.test.js', { git: 'M' }],
    [1, 'forecast.test.js'],
    [0, 'index.js', { git: 'M' }],
    [0, 'package.json'],
    [0, 'README.md'],
  ];

  S.ipadWorkspace = ({ termHeight = 250 } = {}) =>
    T.workspace({
      project: P, branch: 'feat/units', changed: 3, wave: 'success',
      files, filesWidth: 230,
      tabs: [{ path: 'lib/forecast.js', on: true }, { path: 'index.js' }, { path: 'test/format.test.js' }],
      crumbs: [[P, 'lib', 'forecast.js'], 'getForecast'],
      panes: `<div class="ws-pane">${T.editor(forecast, { lang: 'js', active: 11, caret: 50 })}</div>`,
      terminal: T.terminal({ out: testOut, height: termHeight, tabs: 2 }),
      status: { branch: 'feat/units', changed: 3, ln: 11, col: 51, lang: 'JavaScript' },
    });

  const index = `
#!/usr/bin/env node
import * as api from './lib/forecast.js';
import { formatDay } from './lib/format.js';

const city = process.argv[2] ?? 'Lisbon';
const units = process.env.UNITS ?? 'metric';

async function main() {
  const days = await api.getForecast(city, 3);
  console.log(\`Forecast for \${city}\`);
  for (const day of days) {
    console.log(formatDay(day, units));
  }
}

main();`;

  const runOut = [
    `${T.prompt(P)}node index.js Lisbon`,
    `<span class="tt">Forecast for Lisbon</span>`,
    `  Mon  <span class="ty">sunny  </span>  24° / 16°  <span class="td">wind 11 km/h</span>`,
    `  Tue  <span class="tm">cloudy </span>  22° / 15°  <span class="td">wind 14 km/h</span>`,
    `  Wed  <span class="tc">showers</span>  19° / 14°  <span class="td">rain 6 mm</span>`,
    `${T.prompt(P)}python3 scripts/avg.py`,
    `Average high: <span class="tg2">21.7°C</span> over 3 days`,
    `${T.prompt(P)}<span class="cursor-block"></span>`,
  ].join('\n');

  S.phoneRun = () =>
    T.header({ project: P, branch: 'main', changed: 2 }) +
    T.wave({ state: 'success' }) +
    T.tabs([{ path: 'index.js', on: true }, { path: 'lib/forecast.js' }]) +
    T.editor(index, { lang: 'js', active: 10, caret: 39 }) +
    T.terminal({ out: runOut, height: 250 }) +
    T.statusBar({ branch: 'main', changed: 2, ln: 10, col: 40, lang: 'JavaScript' }) +
    T.activity({ active: 'terminal', git: 2 });
})();
