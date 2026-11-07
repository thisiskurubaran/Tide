#!/usr/bin/env node
// Renders the App Store marketing images for Tide from the HTML templates in
// this folder, with Playwright's Chromium, into assets/v2.0.0/.
//
//   node scripts/store-assets/build.js            # every image
//   node scripts/store-assets/build.js iphone/03  # only templates matching
//
// Each template renders at a CSS viewport times deviceScaleFactor, so the PNG
// is exactly the App Store size. The PNG is then rewritten as RGB without an
// alpha channel, which App Store Connect requires.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const HERE = __dirname;
const APP = path.resolve(HERE, '../..');
const OUT = path.join(APP, 'assets/v2.0.0');

// folder → CSS viewport, scale and the exact pixel size it must produce.
const SETS = {
  iphone: { width: 402, height: 874, dsf: 3, px: [1206, 2622] },
  ipad: { width: 1032, height: 1376, dsf: 2, px: [2064, 2752] },
  header: { width: 1920, height: 823, dsf: 2, px: [3840, 1646] },
  search: { width: 1920, height: 1280, dsf: 2, px: [3840, 2560] },
};

const FEATHER = require(path.join(APP, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Feather.json'));

function toRgb(buffer) {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const rgb = Buffer.alloc(width * height * 3);
  // Flatten onto the page background in case anything is translucent.
  const bg = [10, 17, 21];
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3] / 255;
    rgb[j] = Math.round(data[i] * a + bg[0] * (1 - a));
    rgb[j + 1] = Math.round(data[i + 1] * a + bg[1] * (1 - a));
    rgb[j + 2] = Math.round(data[i + 2] * a + bg[2] * (1 - a));
  }
  return { width, height, out: PNG.sync.write({ width, height, data: rgb }, { colorType: 2, inputColorType: 2, inputHasAlpha: false }) };
}

async function main() {
  const filter = process.argv[2];
  const jobs = [];
  for (const [set, spec] of Object.entries(SETS)) {
    const dir = path.join(HERE, set);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort()) {
      const id = `${set}/${file.replace(/\.html$/, '')}`;
      if (filter && !id.includes(filter)) continue;
      jobs.push({ id, set, spec, src: path.join(dir, file), dest: path.join(OUT, set, file.replace(/\.html$/, '.png')) });
    }
  }
  if (!jobs.length) throw new Error(`No templates match ${filter}`);

  const browser = await chromium.launch();
  try {
    for (const job of jobs) {
      let { width, height, dsf } = job.spec;
      const [pw, ph] = job.spec.px;
      // Fall back to an exact-size viewport at 1x if the scale doesn't divide evenly.
      if (Math.round(width * dsf) !== pw || Math.round(height * dsf) !== ph) [width, height, dsf] = [pw, ph, 1];
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
      await context.addInitScript((map) => {
        window.FEATHER = map;
      }, FEATHER);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(`file://${job.src}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      // Fail on any code or terminal line that runs past its pane.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.editor .ln, .term .out, .diff .dl, .peek .pc div, [data-fit]')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => el.textContent.trim().slice(0, 60)),
      );
      if (clipped.length) errors.push(`clipped: ${clipped.join(' | ')}`);
      if (errors.length) throw new Error(`${job.id}: ${errors.join('; ')}`);
      const shot = await page.screenshot({ type: 'png' });
      await context.close();
      const { width: w, height: h, out } = toRgb(shot);
      if (w !== pw || h !== ph) throw new Error(`${job.id} rendered ${w}×${h}, expected ${pw}×${ph}`);
      fs.mkdirSync(path.dirname(job.dest), { recursive: true });
      fs.writeFileSync(job.dest, out);
      console.log(`${path.relative(APP, job.dest)}  ${w}×${h}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
