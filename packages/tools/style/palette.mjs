// Dominant colors and light / saturation overview of a reference picture: threedog style palette <image> [--n 8].
// A helper that measures, not a decision: it does not tell you which colors make the look. Pixels are read in a headless browser
// (canvas getImageData: every format the browser decodes works, no image library needed), then reduced here with a median cut.
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { launchBrowser } from '../browser.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const MAX_SIDE = 200;   // the picture is scaled down to this before reading: the browser's smoothing averages detail, and it keeps the work small

/** RGB pixels (flat [r, g, b, ...], transparent ones skipped) of an image file, scaled to at most MAX_SIDE */
export async function readPixels(file) {
  const path = resolve(file), mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`cannot read "${file}": use ${Object.keys(MIME).join(' ')}`);
  let data;
  try { data = readFileSync(path).toString('base64'); } catch { throw new Error(`cannot read "${file}": file not found`); }
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await page.evaluate(async ([src, max]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, out = [];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) out.push(d[i], d[i + 1], d[i + 2]);
      return out;
    }, [`data:${mime};base64,${data}`, MAX_SIDE]);
  } finally { await browser.close(); }
}

const hex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/** [h 0-360, s 0-1, l 0-1] */
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Median cut of weighted colors [[r,g,b], count] into at most n boxes: [{ rgb (mean), count }] */
function medianCut(entries, n) {
  const boxes = [entries];
  const range = box => [0, 1, 2].map(c => { let lo = 255, hi = 0; for (const [p] of box) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); } return hi - lo; });
  while (boxes.length < n) {
    let bi = -1, best = 0, ch = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b), m = Math.max(...r), score = m * b.reduce((s, e) => s + e[1], 0); if (score > best) { best = score; bi = i; ch = r.indexOf(m); } });
    if (bi < 0) break;
    const b = boxes[bi].sort((x, y) => x[0][ch] - y[0][ch]), half = b.reduce((s, e) => s + e[1], 0) / 2;
    let acc = 0, cut = 0;
    while (cut < b.length - 2 && acc + b[cut][1] < half) acc += b[cut++][1];
    boxes.splice(bi, 1, b.slice(0, cut + 1), b.slice(cut + 1));
  }
  return boxes.filter(b => b.length).map(b => {
    const count = b.reduce((s, e) => s + e[1], 0), rgb = [0, 1, 2].map(c => b.reduce((s, e) => s + e[0][c] * e[1], 0) / count);
    return { rgb, count };
  });
}

const HUES = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [90, 'yellow-green'], [150, 'green'], [190, 'teal'], [210, 'cyan'], [255, 'blue'], [290, 'violet'], [330, 'magenta'], [345, 'pink'], [361, 'red']];
/** Plain-language name of a color: 'light sand', 'dark blue', 'gray'... */
export function colorName(rgb) {
  const [h, s, l] = hsl(rgb);
  if (l > 0.93) return 'white';
  if (l < 0.1) return 'black';
  if (s < 0.1) return l > 0.65 ? 'light gray' : l < 0.35 ? 'dark gray' : 'gray';
  const base = (h >= 25 && h < 60 && s < 0.65 && l > 0.5) ? 'sand' : HUES.find(([m]) => h < m)[1];
  return (l > 0.75 ? 'light ' : l < 0.28 ? 'dark ' : '') + base;
}

const level = (v, lo, hi, names) => names[v < lo ? 0 : v < hi ? 1 : 2];

/** Picture overview: dominant colors with roles, and brightness / saturation / contrast / temperature as numbers and words. n colors (2-32) */
export async function paletteOf(file, n = 8) {
  const px = await readPixels(file), total = px.length / 3;
  if (!total) throw new Error(`"${file}" has no opaque pixels`);
  const hist = new Map();   // 5 bits per channel: the same look to the eye, far fewer entries to cut
  for (let i = 0; i < px.length; i += 3) { const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3); hist.set(k, (hist.get(k) ?? 0) + 1); }
  const entries = [...hist].map(([k, c]) => [[((k >> 10) << 3) + 4, (((k >> 5) & 31) << 3) + 4, ((k & 31) << 3) + 4], c]);
  const colors = medianCut(entries, n).sort((a, b) => b.count - a.count).map(({ rgb, count }) => {
    const [h, s, l] = hsl(rgb);
    return { hex: hex(rgb), name: colorName(rgb), share: +(count / total).toFixed(3), hue: Math.round(h), saturation: +s.toFixed(2), lightness: +l.toFixed(2), brightness: +luma(rgb).toFixed(2), roles: [] };
  });
  // Role hints, one color each (a color may get several): the biggest block, the brightest, the most saturated one that is not a speck (>= 2%), the darkest
  const pick = (key, ok = () => true) => colors.filter(ok).reduce((a, b) => (a && a[key] >= b[key] ? a : b), null);
  const roles = { base: colors[0], highlight: pick('brightness'), accent: pick('saturation', c => c.share >= 0.02), shadow: colors.reduce((a, b) => (a.brightness <= b.brightness ? a : b)) };
  const labels = { base: 'largest block: ground / environment candidate', highlight: 'brightest: highlight / sky candidate', accent: 'most saturated: accent candidate', shadow: 'darkest: shadow / outline candidate' };
  for (const [r, c] of Object.entries(roles)) c?.roles.push(r);

  // Whole-picture numbers from every pixel (not from the reduced colors)
  const lum = [], sat = [];
  let wx = 0, wy = 0, wsum = 0;
  for (let i = 0; i < px.length; i += 3) {
    const c = [px[i], px[i + 1], px[i + 2]], [h, s] = hsl(c);
    lum.push(luma(c)); sat.push(s);
    const w = s * (1 - Math.abs(2 * hsl(c)[2] - 1)); wx += Math.cos(h * Math.PI / 180) * w; wy += Math.sin(h * Math.PI / 180) * w; wsum += w;
  }
  lum.sort((a, b) => a - b);
  const q = p => lum[Math.min(lum.length - 1, Math.floor(p * lum.length))], mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const meanSat = mean(sat), meanLum = mean(lum), contrast = q(0.95) - q(0.05);
  const meanHue = ((Math.atan2(wy, wx) * 180 / Math.PI) + 360) % 360, chroma = Math.hypot(wx, wy) / total;
  const warm = chroma < 0.03 ? 'neutral' : (meanHue < 75 || meanHue >= 330) ? 'warm' : meanHue >= 150 && meanHue < 290 ? 'cool' : 'neutral';
  const stats = { brightness: +meanLum.toFixed(2), saturation: +meanSat.toFixed(2), contrast: +contrast.toFixed(2), temperature: warm, dominantHue: chroma < 0.03 ? null : Math.round(meanHue) };
  const words = [`${warm} colors, mostly ${colors[0].name}`,
    level(meanSat, 0.2, 0.45, ['low saturation', 'medium saturation', 'high saturation']),
    level(meanLum, 0.3, 0.6, ['dark overall', 'medium brightness', 'bright overall']),
    level(contrast, 0.25, 0.55, ['weak light/dark contrast', 'moderate light/dark contrast', 'strong light/dark contrast'])];
  return {
    file: resolve(file), pixels: total, colors, stats, summary: words.join(', '),
    roles: Object.fromEntries(Object.entries(roles).map(([r, c]) => [r, { hex: c.hex, hint: labels[r] }])),
    note: 'A measurement to start from, not a decision: pick the look yourself and compare with `threedog shot`.',
  };
}
