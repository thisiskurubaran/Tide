// Renders app icons and splash images from assets/brand/tide-mark.svg.
// Run with `npm run build:icons` after changing the mark.
const { Resvg } = require('@resvg/resvg-js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets', 'icons');

// Colors match docs/brand.md and src/theme/tokens.ts.
// The light tile is a gradient, drawn with the `tile-gradient` defs every svg() includes.
const light = { tile: 'url(#tile-gradient)', body: '#ffffff', accent: '#d4ddff' };
const tileGradient = ['#3b5bdb', '#0e1a4d'];
// Transparent dark icons, which iOS draws on its own dark background instead of the blue tile.
const dark = { body: '#f1f3f2', accent: '#7c9bff' };

// The Midnight alternate icon (Settings > App icon): a midnight tile and a gold wave.
const midnight = { tile: 'url(#pro-tile)', body: '#ffffff', accent: 'url(#pro-gold)' };
const proTile = ['#1c2347', '#05070f'];
const proGold = ['#ffe08a', '#f5b942', '#d98a1c'];
const FONT = path.join(root, 'assets', 'fonts', 'InstrumentSans-SemiBold.ttf');

const mark = fs.readFileSync(path.join(root, 'assets', 'brand', 'tide-mark.svg'), 'utf8');
const [chevron, wave] = [...mark.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
if (!chevron || !wave) throw new Error('tide-mark.svg no longer has the chevron and wave paths');

function symbol(body, accent) {
  return (
    `<path d="${chevron}" fill="none" stroke="${body}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${wave}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`
  );
}

// viewBox in mark units; the 32-unit tile is placed at `inset` inside `size` units.
function svg(size, inset, content, background) {
  const defs =
    `<defs><linearGradient id="tile-gradient" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${tileGradient[0]}"/><stop offset="1" stop-color="${tileGradient[1]}"/>` +
    `</linearGradient>` +
    `<linearGradient id="pro-tile" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${proTile[0]}"/><stop offset="1" stop-color="${proTile[1]}"/>` +
    `</linearGradient>` +
    `<linearGradient id="pro-gold" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${proGold[0]}"/><stop offset="0.55" stop-color="${proGold[1]}"/><stop offset="1" stop-color="${proGold[2]}"/>` +
    `</linearGradient></defs>`;
  const bg = background ? `<rect x="0" y="0" width="${size}" height="${size}" fill="${background}"/>` : '';
  const scale = (size - inset * 2) / 32;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${defs}${bg}` +
    `<g transform="translate(${inset} ${inset}) scale(${scale})">${content}</g></svg>`
  );
}

function render(source, px) {
  // Any text is set in the app's own font so it renders the same everywhere.
  return new Resvg(source, {
    fitTo: { mode: 'width', value: px },
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Instrument Sans' },
  }).render();
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

// Android adaptive icons are 108dp with the visible part in the middle 72dp. The tile is drawn at
// 81dp so the symbol matches its size on iOS and still fits the 66dp safe circle.
const ANDROID = 108;
const ANDROID_INSET = (108 - 81) / 2;

const outputs = {
  // iOS masks the corners itself, so the tile color runs to the edges.
  'ios-light.png': () => opaquePng(render(svg(32, 0, symbol(light.body, light.accent), light.tile), 1024)),
  // iOS 18 draws dark and tinted icons on its own background, so these are transparent.
  'ios-dark.png': () => render(svg(32, 0, symbol(dark.body, dark.accent)), 1024).asPng(),
  'ios-tinted.png': () => render(svg(32, 0, symbol('#ffffff', '#b8b8b8')), 1024).asPng(),
  'android-background.png': () => render(svg(ANDROID, 0, '', light.tile), 1024).asPng(),
  'android-foreground.png': () =>
    render(svg(ANDROID, ANDROID_INSET, symbol(light.body, light.accent)), 1024).asPng(),
  'android-monochrome.png': () =>
    render(svg(ANDROID, ANDROID_INSET, symbol('#ffffff', '#ffffff')), 1024).asPng(),
  // Midnight, with the same light / dark / tinted set as the main icon.
  'ios-midnight.png': () => opaquePng(render(svg(32, 0, symbol(midnight.body, midnight.accent), midnight.tile), 1024)),
  'ios-midnight-dark.png': () => render(svg(32, 0, symbol(midnight.body, midnight.accent)), 1024).asPng(),
  'ios-midnight-tinted.png': () => render(svg(32, 0, symbol('#ffffff', '#b8b8b8')), 1024).asPng(),
  'android-midnight-foreground.png': () => render(svg(ANDROID, ANDROID_INSET, symbol(midnight.body, midnight.accent)), 1024).asPng(),
  // The blue tile reads on both light and dark backgrounds, so one splash image serves both.
  'splash.png': () => render(svg(32, 0, tile(light)), 512).asPng(),
  'favicon.png': () => render(svg(32, 0, tile(light)), 48).asPng(),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, build] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(out, name), build());
  console.log(`wrote assets/icons/${name}`);
}

// The layered Liquid Glass icon for iOS 26+ (app.json ios.icon). Xcode builds it with
// Icon Composer's renderer and also flattens it for iOS 17 and 18. The chevron and the
// wave are separate groups, so the system gives them depth and glass highlights; it
// derives the dark, tinted and clear versions itself. Open it in Icon Composer to tune.
const ICON = path.join(out, 'Tide.icon');
const layerSvg = (d, color, join) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="1024" height="1024">` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"${join ? ' stroke-linejoin="round"' : ''}/></svg>\n`;
const srgb = (hex) =>
  'srgb:' + [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(',') + ',1.00000';
const glassGroup = (name) => ({
  layers: [{ 'image-name': `${name}.svg`, name }],
  shadow: { kind: 'neutral', opacity: 0.5 },
  translucency: { enabled: true, value: 0.5 },
});
fs.mkdirSync(path.join(ICON, 'Assets'), { recursive: true });
fs.writeFileSync(path.join(ICON, 'Assets', 'chevron.svg'), layerSvg(chevron, light.body, true));
fs.writeFileSync(path.join(ICON, 'Assets', 'wave.svg'), layerSvg(wave, light.accent, false));
fs.writeFileSync(
  path.join(ICON, 'icon.json'),
  JSON.stringify(
    {
      fill: { 'automatic-gradient': srgb(tileGradient[0]) },
      groups: [glassGroup('chevron'), glassGroup('wave')],
      'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
    },
    null,
    2,
  ) + '\n',
);
console.log('wrote assets/icons/Tide.icon');
