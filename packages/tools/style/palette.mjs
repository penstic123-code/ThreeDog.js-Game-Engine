// Dominant colors and light / saturation overview of a reference picture:
//   threedog style palette <image> [--n 8] [--average] [--region x,y,w,h] [--ignore-ui] [--crop file.png]
// A helper that measures, not a decision: it does not tell you which colors make the look. Pixels are read in a headless browser
// (pixels.mjs), then reduced here with a median cut.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openImage, hsl, luma, hex, opaque, uiFrame, shrink } from './pixels.mjs';

const MAX_SIDE = 200;   // the picture is scaled down to this before reading: the browser's smoothing averages detail, and it keeps the work small
const SCAN_SIDE = 400;  // --ignore-ui looks for the frame at this size

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

/** Mean color of flat [r, g, b, ...] pixels, as { rgb, hex, hue, saturation, lightness } (the mean of the channel values, not a cluster) */
export function averageColor(px) {
  const total = px.length / 3, rgb = [0, 0, 0];
  for (let i = 0; i < px.length; i += 3) { rgb[0] += px[i]; rgb[1] += px[i + 1]; rgb[2] += px[i + 2]; }
  const m = rgb.map(v => v / total), [h, s, l] = hsl(m);
  return { rgb: m, hex: hex(m), hue: Math.round(h), saturation: +s.toFixed(2), lightness: +l.toFixed(2) };
}

/** Dominant colors of flat [r, g, b, ...] pixels, biggest first: [{ hex, name, share, hue, saturation, lightness, brightness, roles: [] }] */
export function dominantColors(px, n) {
  const total = px.length / 3;
  const hist = new Map();   // 5 bits per channel: the same look to the eye, far fewer entries to cut
  for (let i = 0; i < px.length; i += 3) { const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3); hist.set(k, (hist.get(k) ?? 0) + 1); }
  const entries = [...hist].map(([k, c]) => [[((k >> 10) << 3) + 4, (((k >> 5) & 31) << 3) + 4, ((k & 31) << 3) + 4], c]);
  return medianCut(entries, n).sort((a, b) => b.count - a.count).map(({ rgb, count }) => {
    const [h, s, l] = hsl(rgb);
    return { hex: hex(rgb), name: colorName(rgb), share: +(count / total).toFixed(3), hue: Math.round(h), saturation: +s.toFixed(2), lightness: +l.toFixed(2), brightness: +luma(rgb).toFixed(2), roles: [] };
  });
}

/**
 * Picture overview: dominant colors with roles, and brightness / saturation / contrast / temperature as numbers and words. n colors (2-32).
 * opts: average (add the whole-picture mean color), region ({x,y,w,h} original pixels), ignoreUi (cut a flat frame around the picture, see pixels.uiFrame),
 * crop (path: write the measured area there as a PNG so you can look at what was measured). The result's `basis` says what was measured.
 */
export async function paletteOf(file, n = 8, { average = false, region, ignoreUi = false, crop } = {}) {
  const img = await openImage(file);
  let px, basis;
  try {
    const whole = region ?? { x: 0, y: 0, w: img.width, h: img.height };
    let area = whole, frame = null;
    if (ignoreUi) {
      const scan = await img.read(whole, { max: SCAN_SIDE }), f = uiFrame(scan.data, scan.w, scan.h);
      area = shrink(whole, f);
      frame = { top: Math.round(f.top * whole.h), right: Math.round(f.right * whole.w), bottom: Math.round(f.bottom * whole.h), left: Math.round(f.left * whole.w) };
    }
    const got = await img.read(area, { max: MAX_SIDE, png: !!crop });
    if (crop) writeFileSync(resolve(crop), got.png);
    px = opaque(got.data);
    basis = { size: [img.width, img.height], region: area, ignoredFramePx: frame, cropFile: crop ? resolve(crop) : null,
      text: `${region ? 'region ' + Object.values(region).join(',') : 'whole picture'}${frame ? `, UI frame cut (px top/right/bottom/left: ${Object.values(frame).join('/')}; a side counts as frame when it is a flat color, at least 3% and at most 45% of the picture)` : ''}, scaled to at most ${MAX_SIDE}px` };
  } finally { await img.close(); }
  const total = px.length / 3;
  if (!total) throw new Error(`"${file}" has no opaque pixels`);
  const colors = dominantColors(px, n);
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
  const avg = average ? averageColor(px) : null;
  if (avg) words.push(`overall average color ${avg.hex} (hue ${avg.hue}°, saturation ${avg.saturation}, lightness ${avg.lightness})`);
  return {
    file: resolve(file), basis, pixels: total, colors, ...(avg && { average: { hex: avg.hex, hue: avg.hue, saturation: avg.saturation, lightness: avg.lightness } }), stats, summary: words.join(', '),
    roles: Object.fromEntries(Object.entries(roles).map(([r, c]) => [r, { hex: c.hex, hint: labels[r] }])),
    note: 'A measurement to start from, not a decision: pick the look yourself and compare with `threedog shot`.',
  };
}
