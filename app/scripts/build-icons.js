// Renders app icons and splash images from assets/brand/tide-mark.svg.
// Run with `npm run build:icons` after changing the mark.
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets', 'icons');

// Colors match docs/brand.md and src/theme/tokens.ts.
const light = { tile: '#111413', body: '#fcfcfb', accent: '#7c9bff' };
const dark = { tile: '#f1f3f2', body: '#0d0f0e', accent: '#1d4ed8' };

const mark = fs.readFileSync(path.join(root, 'assets', 'brand', 'tide-mark.svg'), 'utf8');
const [chevron, wave] = [...mark.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
if (!chevron || !wave) throw new Error('tide-mark.svg no longer has the chevron and wave paths');

function symbol(body, accent) {
  return (
    `<path d="${chevron}" fill="none" stroke="${body}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${wave}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`
  );
}

// viewBox in mark units; the 32-unit tile is placed at `inset` inside `size` units.
function svg(size, inset, content, background) {
  const bg = background ? `<rect x="0" y="0" width="${size}" height="${size}" fill="${background}"/>` : '';
  const scale = (size - inset * 2) / 32;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${bg}` +
    `<g transform="translate(${inset} ${inset}) scale(${scale})">${content}</g></svg>`
  );
}

function render(source, px) {
  return new Resvg(source, { fitTo: { mode: 'width', value: px } }).render();
}

// App Store icons must not have an alpha channel, so re-encode as 8-bit RGB.
function opaquePng(image) {
  const { width, height, pixels } = image;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      raw.set(pixels.subarray(src, src + 3), row + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tile = (c) => `<rect width="32" height="32" rx="8" fill="${c.tile}"/>` + symbol(c.body, c.accent);

// Android adaptive icons are 108dp with the visible part in the middle 72dp.
const ANDROID = 108;
const ANDROID_INSET = (108 - 72) / 2;

const outputs = {
  // iOS masks the corners itself, so the tile color runs to the edges.
  'ios-light.png': () => opaquePng(render(svg(32, 0, symbol(light.body, light.accent), light.tile), 1024)),
  // iOS 18 draws dark and tinted icons on its own background, so these are transparent.
  'ios-dark.png': () => render(svg(32, 0, symbol(dark.tile, light.accent)), 1024).asPng(),
  'ios-tinted.png': () => render(svg(32, 0, symbol('#ffffff', '#b8b8b8')), 1024).asPng(),
  'android-foreground.png': () =>
    render(svg(ANDROID, ANDROID_INSET, symbol(light.body, light.accent)), 1024).asPng(),
  'android-monochrome.png': () =>
    render(svg(ANDROID, ANDROID_INSET, symbol('#ffffff', '#ffffff')), 1024).asPng(),
  'splash-dark.png': () => render(svg(32, 0, tile(dark)), 512).asPng(),
  'splash-light.png': () => render(svg(32, 0, tile(light)), 512).asPng(),
  'favicon.png': () => render(svg(32, 0, tile(light)), 48).asPng(),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, build] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(out, name), build());
  console.log(`wrote assets/icons/${name}`);
}
