// picture tools: `picture palette` on a generated PNG, the png() helper the other picture tests share, and that the style tool is gone.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import * as P from '../paths.mjs';
import { EXTRA } from '../threedog/command-table.mjs';
import { SCRIPTS } from '../bin/threedog.mjs';
import { paletteOf } from '../picture/palette.mjs';

export const name = 'picture tools: palette';

export const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** A PNG of w×h pixels, color(x, y) → [r, g, b] */
export function png(w, h, color) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw.set(color(x, y), o + 1 + x * 3); }
  const chunk = (type, data) => {
    const t = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), c = Buffer.alloc(4);
    len.writeUInt32BE(data.length); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const near = (hex, rgb, tol = 24) => [1, 3, 5].every((i, k) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - rgb[k]) <= tol);

export async function run({ check }) {
  check('CLI: picture-palette help lists only options palette has (no --out)', !EXTRA['picture-palette'].includes('--out'), EXTRA['picture-palette']);
  check('the style tool is gone: no `threedog style`, no style-* bridge command; `threedog picture` runs',
    !('style' in SCRIPTS) && SCRIPTS.picture === 'picture.mjs' && !Object.keys(EXTRA).some(k => k.startsWith('style-')));
  check('paths.mjs has no style-package lookups left (STYLE_PKG_PREFIX / STYLES_REL / styleName / styleDir)',
    !['STYLE_PKG_PREFIX', 'STYLES_REL', 'styleName', 'styleDir'].some(k => k in P));

  // ── palette: 60×40 picture, 70% sand, 20% dark blue, 10% bright red ──
  const tmp2 = mkdtempSync(join(tmpdir(), 'threedog-pal-'));
  try {
    const sand = [216, 192, 144], navy = [20, 30, 90], red = [230, 30, 30];
    writeFileSync(join(tmp2, 'ref.png'), png(60, 40, (x, y) => (y < 28 ? sand : y < 36 ? navy : red)));
    const p = await paletteOf(join(tmp2, 'ref.png'), 4);
    check('palette: the biggest color is the sand and is the base candidate', near(p.colors[0].hex, sand) && p.colors[0].roles.includes('base') &&
      near(p.roles.base.hex, sand));
    check('palette: the red is the most saturated (accent) and the navy the darkest', near(p.roles.accent.hex, red, 30) && near(p.roles.shadow.hex, navy, 30));
    check('palette: shares add up and the largest is about 70%', Math.abs(p.colors[0].share - 0.7) < 0.05);
    check('palette: summary says warm, mostly sand', p.stats.temperature === 'warm' && /warm colors, mostly (light )?sand/.test(p.summary));
    writeFileSync(join(tmp2, 'gray.png'), png(20, 20, () => [128, 128, 128]));
    const gray = await paletteOf(join(tmp2, 'gray.png'), 3);
    check('palette: a flat gray picture is neutral, low saturation, weak contrast', gray.stats.temperature === 'neutral' &&
      /low saturation/.test(gray.summary) && /weak light\/dark contrast/.test(gray.summary));
    check('palette: an unsupported file name gives a clear error', await paletteOf(join(tmp2, 'x.txt')).then(() => false, e => /use \.png/.test(e.message)));
  } finally { rmSync(tmp2, { recursive: true, force: true }); }
}
