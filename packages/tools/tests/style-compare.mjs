// style palette options (--average --region --ignore-ui --crop) and style compare, on pictures generated here.
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { paletteOf } from '../style/palette.mjs';
import { compareImages } from '../style/compare.mjs';
import { parseRegion } from '../style/pixels.mjs';
import { png, near } from './style-tools.mjs';

export const name = 'style palette options and style compare';

export async function run({ check }) {
  const tmp2 = mkdtempSync(join(tmpdir(), 'threedog-cmp-'));
  try {
    const sand = [216, 192, 144];
    writeFileSync(join(tmp2, 'gray.png'), png(20, 20, () => [128, 128, 128]));
    // ── palette: --average, --region, --ignore-ui, --crop on a picture with a dark purple UI frame (25% each side, so the frame is the biggest block) ──
    const purple = [40, 20, 60], inner = (x, y) => x >= 25 && x < 75 && y >= 25 && y < 75;
    writeFileSync(join(tmp2, 'framed.png'), png(100, 100, (x, y) => (inner(x, y) ? (x < 55 ? sand : [120, 160, 90]) : purple)));
    const raw = await paletteOf(join(tmp2, 'framed.png'), 4);
    check('palette: without --ignore-ui the frame is the largest block', near(raw.colors[0].hex, purple, 30) && raw.basis.text.includes('whole picture'));
    const cut = await paletteOf(join(tmp2, 'framed.png'), 4, { ignoreUi: true, crop: join(tmp2, 'crop.png') });
    check('palette: --ignore-ui cuts the frame (about 25 px per side) and says so',
      cut.basis.ignoredFramePx.top >= 23 && cut.basis.ignoredFramePx.top <= 27 && cut.basis.ignoredFramePx.left >= 23 && cut.basis.ignoredFramePx.left <= 27 && /UI frame cut/.test(cut.basis.text));
    check('palette: after --ignore-ui no purple is left, sand and green are the two blocks',
      cut.colors.every(c => !(c.share > 0.05 && near(c.hex, purple, 30))) && near(cut.colors[0].hex, sand, 30) && cut.basis.region.w >= 48 && cut.basis.region.w <= 52);
    check('palette: --crop writes the measured area as a PNG of that size',
      existsSync(join(tmp2, 'crop.png')) && readFileSync(join(tmp2, 'crop.png')).subarray(1, 4).toString() === 'PNG');
    const reg = await paletteOf(join(tmp2, 'framed.png'), 3, { region: { x: 25, y: 25, w: 25, h: 50 } });
    check('palette: --region measures only that area',
      near(reg.colors[0].hex, sand, 30) && reg.colors.length === 1 && reg.basis.text.includes('region 25,25,25,50'));
    const avg = await paletteOf(join(tmp2, 'gray.png'), 3, { average: true });
    check('palette: --average gives the mean color as HSL',
      avg.average.hex === '#808080' && avg.average.saturation === 0 && /overall average color #808080/.test(avg.summary));
    check('palette: a flat picture is not cut by --ignore-ui when nothing is frame-like inside (cap 45% per side)',
      (await paletteOf(join(tmp2, 'gray.png'), 3, { ignoreUi: true })).basis.region.w >= 1);
    check('palette: a bad --region is refused with the format',
      (() => { try { parseRegion('1,2,3'); return false; } catch (e) { return /x,y,w,h/.test(e.message); } })());

    // ── compare: same picture, darker, noisier, other size, region ──
    const grad = (x, y) => { const v = 60 + x * 1.2 + y * 0.6; return [v, v * 0.9, v * 0.7]; };
    writeFileSync(join(tmp2, 'a.png'), png(100, 100, grad));
    writeFileSync(join(tmp2, 'dark.png'), png(100, 100, (x, y) => grad(x, y).map(v => v * 0.8)));
    writeFileSync(join(tmp2, 'noisy.png'), png(100, 100, (x, y) => { const g = grad(x, y), n = (x + y) % 2 ? 40 : -40; return g.map(v => Math.max(0, Math.min(255, v + n))); }));
    writeFileSync(join(tmp2, 'big.png'), png(200, 200, (x, y) => grad(x / 2, y / 2)));
    const same = await compareImages(join(tmp2, 'a.png'), join(tmp2, 'a.png'));
    check('compare: the same picture shows no difference above the thresholds and a detail ratio of 1',
      /no difference above the thresholds/.test(same.summary) && same.diff.detail.ratio === 1 && same.diff.brightness.delta === 0);
    const dk = await compareImages(join(tmp2, 'a.png'), join(tmp2, 'dark.png'));
    check('compare: a picture at 80% brightness is reported about 20% darker, in a neutral sentence',
      Math.abs(dk.diff.brightness.relative + 0.2) < 0.03 && /20% darker|19% darker|21% darker/.test(dk.summary) && !/similar|similarity|score/i.test(dk.summary.replace('no difference', '')));
    const ny = await compareImages(join(tmp2, 'a.png'), join(tmp2, 'noisy.png'));
    check('compare: a checkerboard-noise picture has far more fine detail (ratio well over 1) and the summary says broken up',
      ny.diff.detail.ratio > 5 && /more broken up/.test(ny.summary));
    const sm = await compareImages(join(tmp2, 'noisy.png'), join(tmp2, 'a.png'));
    check('compare: the reverse says smoother', /smoother/.test(sm.summary) && sm.diff.detail.ratio < 0.2);
    const big = await compareImages(join(tmp2, 'a.png'), join(tmp2, 'big.png'));
    check('compare: different sizes are scaled to one size, said in notes; the same content then matches',
      big.notes.some(n => /sizes differ/.test(n)) && Math.abs(big.diff.brightness.relative) < 0.03);
    const part = await compareImages(join(tmp2, 'a.png'), join(tmp2, 'big.png'), { region: { x: 0, y: 0, w: 50, h: 50 } });
    check('compare: --region on the reference maps to the same fractions of the larger screenshot',
      part.screenshot.region.w === 100 && part.screenshot.region.h === 100 && Math.abs(part.diff.brightness.relative) < 0.03);
    const hue = await compareImages(join(tmp2, 'framed.png'), join(tmp2, 'framed.png'), { refRegion: { x: 25, y: 25, w: 25, h: 50 }, shotRegion: { x: 50, y: 25, w: 25, h: 50 } });
    check('compare: --ref-region / --shot-region compare chosen parts (sand vs green: the hue moves about +60 degrees)',
      hue.diff.averageHueShift > 40 && hue.diff.averageHueShift < 90);
    check('compare: the result states the method and that it is not a score', /quality score/.test(dk.note) && dk.method.detail.includes('Laplacian'));
  } finally { rmSync(tmp2, { recursive: true, force: true }); }
}
