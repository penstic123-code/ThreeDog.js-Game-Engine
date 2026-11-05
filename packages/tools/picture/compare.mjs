// threedog picture compare <reference> <screenshot> [--region x,y,w,h] [--ref-region ..] [--shot-region ..] [--json]
// Measures how a screenshot differs from a reference picture: brightness, saturation, contrast, fine detail, average color, main color.
// An aid to judging, not a replacement for looking: every number is one narrow view of the picture, none is a quality score.
// Both pictures are read through the same pipeline (pixels.mjs) at the same size, so the numbers are comparable.
import { resolve } from 'node:path';
import { openImage, writeSideBySide, hsl, luma, opaque, laplacianVariance } from './pixels.mjs';
import { averageColor, dominantColors } from './palette.mjs';

const SIDE = 512;   // both pictures are brought to this longest side (or the region's own size when smaller)
const hueGap = (a, b) => ((b - a + 540) % 360) - 180;   // signed shortest turn from a to b, degrees

/** The numbers of one RGBA raster */
export function measure(rgba, w, h) {
  const px = opaque(rgba), total = px.length / 3, lum = [], sat = [];
  if (!total) throw new Error('the picture or region has no opaque pixels to measure');
  for (let i = 0; i < px.length; i += 3) { const c = [px[i], px[i + 1], px[i + 2]]; lum.push(luma(c)); sat.push(hsl(c)[1]); }
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length, m = mean(lum), avg = averageColor(px), main = dominantColors(px, 6)[0];
  return {
    brightness: +m.toFixed(3), saturation: +mean(sat).toFixed(3), contrast: +Math.sqrt(mean(lum.map(v => (v - m) ** 2))).toFixed(3),
    detail: +laplacianVariance(rgba, w, h).toFixed(1),
    average: { hex: avg.hex, hue: avg.hue, saturation: avg.saturation, lightness: avg.lightness },
    main: { hex: main.hex, name: main.name, share: main.share, hue: main.hue, saturation: main.saturation, lightness: main.lightness }, pixels: total,
  };
}

// from zero every increase is the whole change: a gray reference against a colorful shot must not read as no difference
const rel = (a, b) => (a > 1e-6 ? (b - a) / a : b > 1e-6 ? 1 : 0);
const pct = v => `${Math.abs(Math.round(v * 100))}%`;

/** One neutral sentence from the differences that pass a noise threshold; says so when none does */
function sentence(d, a, b) {
  const parts = [];
  if (Math.abs(d.brightness.relative) >= 0.05) parts.push(`${pct(d.brightness.relative)} ${d.brightness.relative < 0 ? 'darker' : 'brighter'}`);
  if (Math.abs(d.saturation.relative) >= 0.1) parts.push(`${pct(d.saturation.relative)} ${d.saturation.relative < 0 ? 'less' : 'more'} saturated`);
  if (Math.abs(d.contrast.relative) >= 0.1) parts.push(`${pct(d.contrast.relative)} ${d.contrast.relative < 0 ? 'lower' : 'higher'} light/dark contrast`);
  const ratio = d.detail.ratio;
  if (ratio !== null && (ratio >= 1.25 || ratio <= 0.8)) parts.push(ratio >= 1 ? `${ratio.toFixed(1)}x more broken up (fine detail)` : `${(1 / ratio).toFixed(1)}x smoother (less fine detail)`);
  if (d.averageHueShift !== null && Math.abs(d.averageHueShift) >= 5) parts.push(`off in overall hue by ${Math.abs(d.averageHueShift)}° (${d.averageHueShift > 0 ? '+' : '-'} along the hue wheel)`);
  else if (d.averageHueShift === null && (a.average.saturation >= 0.1) !== (b.average.saturation >= 0.1)) parts.push(`different in whether the overall color is nearly gray`);
  if (!parts.length) return 'Screenshot vs reference: no difference above the thresholds (brightness 5%, saturation 10%, contrast 10%, detail 1.25x, hue 5°). That does not mean they look alike; look at both.';
  return `Compared with the reference, the screenshot is ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]}.`;
}

/** Region of the screenshot that matches `region` of the reference when the sizes differ: the same fractions of the picture */
const mapRegion = (r, from, to) => {
  const x = Math.round(r.x * to.width / from.width), y = Math.round(r.y * to.height / from.height);   // rounding must not push a region at the edge outside
  return { x, y, w: Math.max(1, Math.min(to.width - x, Math.round(r.w * to.width / from.width))), h: Math.max(1, Math.min(to.height - y, Math.round(r.h * to.height / from.height))) };
};

/**
 * Compare a screenshot with a reference. opts: region (reference pixels; the screenshot gets the same fractions of its own size),
 * refRegion / shotRegion (each in its own pixels, win over region). out: PNG path for the side-by-side picture (reference left, screenshot right).
 */
export async function compareImages(refFile, shotFile, { region, refRegion, shotRegion, out } = {}) {
  const ref = await openImage(refFile), shot = await openImage(shotFile).catch(async e => { await ref.close(); throw e; });
  try {
    const rr = refRegion ?? region ?? { x: 0, y: 0, w: ref.width, h: ref.height };
    const sr = shotRegion ?? (region ? mapRegion(region, ref, shot) : { x: 0, y: 0, w: shot.width, h: shot.height });
    // One shared size no larger than either region: upscaling the smaller picture blurs it (a 540 px shot against a 1080 px reference read at the
    // reference's size measured about 10x less detail), so both go down to the smaller one's scale and detail compares like with like
    const k = Math.min(1, SIDE / Math.max(rr.w, rr.h), sr.w / rr.w, sr.h / rr.h), size = [Math.max(3, Math.round(rr.w * k)), Math.max(3, Math.round(rr.h * k))];
    const [A, B] = [await ref.read(rr, { size }), await shot.read(sr, { size })];
    const a = measure(A.data, A.w, A.h), b = measure(B.data, B.w, B.h);
    const gray = x => x.average.saturation < 0.1;
    const shift = gray(a) || gray(b) ? null : Math.round(hueGap(a.average.hue, b.average.hue));
    const mainShift = gray({ average: a.main }) || gray({ average: b.main }) ? null : Math.round(hueGap(a.main.hue, b.main.hue));
    const diff = {
      brightness: { delta: +(b.brightness - a.brightness).toFixed(3), relative: +rel(a.brightness, b.brightness).toFixed(3) },
      saturation: { delta: +(b.saturation - a.saturation).toFixed(3), relative: +rel(a.saturation, b.saturation).toFixed(3) },
      contrast: { delta: +(b.contrast - a.contrast).toFixed(3), relative: +rel(a.contrast, b.contrast).toFixed(3) },
      detail: { ratio: a.detail > 1e-6 ? +(b.detail / a.detail).toFixed(2) : null },
      averageHueShift: shift,
      main: { hue: mainShift, saturation: +(b.main.saturation - a.main.saturation).toFixed(2), lightness: +(b.main.lightness - a.main.lightness).toFixed(2) },
    };
    const notes = [`both pictures read at ${size[0]}×${size[1]}`];
    if (ref.width * ref.height !== shot.width * shot.height || ref.width !== shot.width) notes.push(`sizes differ (reference ${ref.width}×${ref.height}, screenshot ${shot.width}×${shot.height}): both regions scaled to the same size`);
    if (rr.w !== sr.w || rr.h !== sr.h) notes.push(`resolutions differ: detail is measured at the smaller picture's scale (${size[0]}×${size[1]}, neither is enlarged)`);
    notes.push('regions are matched by position only: a feature that sits elsewhere in the screenshot (camera moved, object shifted) shows up as large hue / color differences; cut the same content with --ref-region / --shot-region');
    if (Math.abs(rr.w / rr.h / (sr.w / sr.h) - 1) > 0.05) notes.push('the two regions have different aspect ratios: the screenshot is stretched to the reference shape; use --ref-region / --shot-region to cut the same content');
    let sideBySide = null;
    if (out) {   // same height for both, each keeps its own region's shape (so differently shaped regions are not stretched here); capped so the file stays small
      const H = Math.min(720, Math.max(rr.h, sr.h)), wOf = r => Math.max(1, Math.round(r.w * H / r.h));
      const [L, R] = [await ref.read(rr, { size: [wOf(rr), H] }), await shot.read(sr, { size: [wOf(sr), H] })];
      const got = await writeSideBySide(L, R, ['reference', 'screenshot'], out);
      sideBySide = { file: resolve(out), size: [got.w, got.h] };
    }
    return {
      sideBySide,
      reference: { file: resolve(refFile), size: [ref.width, ref.height], region: rr, ...a },
      screenshot: { file: resolve(shotFile), size: [shot.width, shot.height], region: sr, ...b },
      diff, summary: sentence(diff, a, b), notes,
      method: {
        brightness: 'mean luma (Rec.709 weights on sRGB values) 0-1', saturation: 'mean HSL saturation 0-1', contrast: 'standard deviation of luma 0-1',
        detail: 'variance of the 4-neighbor Laplacian of luma 0-255 at the shared size; higher = more edges / noise / fine texture; compare as a ratio',
        average: 'mean of the channel values over all pixels, shown as HSL', main: 'largest block of a 6-color median cut',
        hueShift: 'signed shortest turn in degrees, reference to screenshot (null when either picture is nearly gray)',
      },
      note: 'An aid to judging, not a replacement for looking: each number is one narrow view, none is a quality score and there is no "similarity %". Look at both pictures too.',
    };
  } finally { await ref.close(); await shot.close(); }
}

/** Plain-text table of a compareImages result */
export function formatCompare(r) {
  const row = (n, a, b, d) => `  ${n.padEnd(12)}${String(a).padEnd(14)}${String(b).padEnd(14)}${d}`;
  const [A, B, D] = [r.reference, r.screenshot, r.diff], sgn = v => (v > 0 ? '+' : '') + v;
  return [
    `reference  ${A.file} ${A.size.join('×')} region ${Object.values(A.region).join(',')}`,
    `screenshot ${B.file} ${B.size.join('×')} region ${Object.values(B.region).join(',')}`,
    row('', 'reference', 'screenshot', 'difference'),
    row('brightness', A.brightness, B.brightness, `${sgn(D.brightness.delta)} (${sgn(Math.round(D.brightness.relative * 100))}%)`),
    row('saturation', A.saturation, B.saturation, `${sgn(D.saturation.delta)} (${sgn(Math.round(D.saturation.relative * 100))}%)`),
    row('contrast', A.contrast, B.contrast, `${sgn(D.contrast.delta)} (${sgn(Math.round(D.contrast.relative * 100))}%)`),
    row('detail', A.detail, B.detail, D.detail.ratio === null ? '-' : `x${D.detail.ratio}`),
    row('average', `${A.average.hex}`, `${B.average.hex}`, D.averageHueShift === null ? 'hue n/a (nearly gray)' : `hue ${sgn(D.averageHueShift)}°`),
    row('main color', `${A.main.hex}`, `${B.main.hex}`, `${D.main.hue === null ? 'hue n/a' : `hue ${sgn(D.main.hue)}°`}, sat ${sgn(D.main.saturation)}, light ${sgn(D.main.lightness)}`),
    ...r.notes.map(n => `  note: ${n}`),
    ...(r.sideBySide ? [`side by side (reference left, screenshot right): ${r.sideBySide.file} ${r.sideBySide.size.join('×')} - open this one image and look at both`] : []),
    r.summary, r.note,
  ].join('\n');
}

/** One number for "did the picture change": mean absolute RGB difference of the two pictures at 128x72, 0 = identical, 1 = black vs white */
export async function pixelDiff(fileA, fileB) {
  const a = await openImage(fileA), b = await openImage(fileB).catch(async e => { await a.close(); throw e; });
  try {
    const size = [128, 72], [A, B] = [await a.read(undefined, { size }), await b.read(undefined, { size })];
    let sum = 0, n = 0;
    for (let i = 0; i < A.data.length; i += 4) { for (let c = 0; c < 3; c++) sum += Math.abs(A.data[i + c] - B.data[i + c]); n += 3; }
    return +(sum / n / 255).toFixed(4);
  } finally { await a.close(); await b.close(); }
}
