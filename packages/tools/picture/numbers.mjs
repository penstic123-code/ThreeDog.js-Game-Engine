// The picture check's pixel maths, node side: whole-picture numbers, shadow edges, and what counts as clipped or near white (the probe gets HOT passed in).
import { luma } from './pixels.mjs';

/** the probe picture's width (the probe's default size): a saved picture is read at this width too, so its spots and shares compare with a shot's */
export const PROBE_W = 240;

/**
 * What counts as clipped: one channel at the top AND bright overall. Why not "all channels >= 250": warm blow-outs (255, 240, 200: a lamp head,
 * the wall beside it) never have blue at the top, so a rainy night full of glaring lamps measured 0% overexposed. Why the luma floor: a saturated
 * pure red sign (255, 0, 0) has a channel at the top but is not blown out. Used by pictureNumbers (node) and passed to the probe (page) so both agree.
 */
export const CLIP = { channel: 250, luma: 0.75 };
/**
 * Near white, for glare spots: a light's hotspot measured on the small probe picture (240 wide) averages with its surroundings, so a lamp head
 * that is 252 on the full shot reads ~245 there. The whole-picture share keeps CLIP (a bright overcast sky is near white without being a fault);
 * HOT is only used for spots and for what one light or glowing material blows out (the probe's glare).
 */
export const HOT = { channel: 240, luma: 0.7 };

/**
 * Whole-picture numbers of RGBA bytes: luminance, saturation, overexposed and dark shares, contrast (std of luma), range (luma p95 - p5), and, with the width, hotspots:
 * the near-white (HOT) pixels grouped into spots (4-connected, 3+ pixels). Why spots: a few glaring lamps are a small share of the picture, so
 * the share alone stays near 0 while each spot is plainly blown out.
 * @param {Uint8Array | Buffer} rgba @param {number} [width] image width in pixels (no hotspots without it)
 */
export function pictureNumbers(rgba, width) {
  const n = rgba.length / 4, L = new Float32Array(n), hot = new Uint8Array(n);
  let lum = 0, sat = 0, over = 0, dark = 0;
  for (let i = 0, k = 0; i < rgba.length; i += 4, k++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    lum += L[k] = luma([r, g, b]); if (mx) sat += (mx - mn) / mx;
    if (mx >= CLIP.channel && L[k] >= CLIP.luma) over++;
    if (mx >= HOT.channel && L[k] >= HOT.luma) hot[k] = 1;
    if (mx <= 20) dark++;
  }
  if (!n) return { luminance: 0, saturation: 0, contrast: 0, range: 0, overexposed: 0, dark: 0, hotspots: 0 };
  const m = lum / n;
  let v = 0; for (const x of L) v += (x - m) ** 2;
  const s = L.slice().sort(), p = q => s[Math.min(n - 1, Math.floor(q * n))];
  const r3 = x => +x.toFixed(3);
  return { luminance: r3(m), saturation: r3(sat / n), contrast: r3(Math.sqrt(v / n)), range: r3(p(0.95) - p(0.05)), overexposed: r3(over / n), dark: r3(dark / n),
    hotspots: width ? spots(hot, width).length : 0 };
}

/** The 4-connected groups of set pixels with 3 or more pixels, as { size, at: their first pixel } (a flood fill) */
function spots(mask, w) {
  const seen = new Uint8Array(mask.length), out = [], stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let size = 0; seen[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop(); size++;
      const x = j % w;
      for (const k of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w, j + w]) if (k >= 0 && k < mask.length && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    if (size >= 3) out.push({ size, at: i });
  }
  return out;
}

/**
 * Shadow stripes and stepped edges from the mask of shadowed pixels at canvas pixels (1 = the shadow darkens this pixel). Why on the mask and not
 * on the picture: textures and geometry are full of edges, the mask holds only what the shadow map adds. Why at canvas pixels: the probe's small
 * copy averages stripes a few pixels wide away. Read in 16-pixel cells.
 *   stripes: most rows or columns of a cell cross several lit / shadowed bands (a surface shadowing itself). A solid shadow's edge crosses once.
 *   jag:     outer and inner corners side by side in a 128-pixel window (2 x 2 blocks of 64, so a block border cannot split a stair). Why: a majority filter leaves a straight edge alone at any slope and rounds off
 *            every corner, so what it changes are the corners; a stair of shadow map pixels alternates outer and inner ones, while a real shadow
 *            has a few, far apart and mostly outer.
 * Shares are of the cells or blocks read; the numbers decide whether a fact is worth a line, they are no goal.
 * @param {Uint8Array} m one value per pixel, 0 or 1 @param {number} w @param {number} h
 * @returns {{ stripes: number, jag: number }}
 */
export function shadowEdges(m, w, h) {
  const S = 16, B = 64, R = 4, STAIR = 3, cw = Math.floor(w / S), ch = Math.floor(h / S);
  if (!cw || !ch) return { stripes: 0, jag: 0 };
  let striped = 0;
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let on = 0, tx = 0, ty = 0;
    for (let y = cy * S; y < cy * S + S; y++) for (let x = cx * S; x < cx * S + S; x++) {
      const v = m[y * w + x]; on += v;
      if (x > cx * S && v !== m[y * w + x - 1]) tx++;
      if (y > cy * S && v !== m[(y - 1) * w + x]) ty++;
    }
    if (on >= 0.1 * S * S && on <= 0.9 * S * S && Math.max(tx, ty) >= 2 * S) striped++;
  }
  const sum = new Int32Array((w + 1) * (h + 1));   // summed-area table: any window's count in four reads
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) { row += m[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; }
  const outer = new Uint8Array(w * h), inner = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.max(0, x - R), b = Math.max(0, y - R), c = Math.min(w, x + R + 1), d = Math.min(h, y + R + 1);
    const n = sum[d * (w + 1) + c] - sum[b * (w + 1) + c] - sum[d * (w + 1) + a] + sum[b * (w + 1) + a], most = 2 * n > (c - a) * (d - b) ? 1 : 0, v = m[y * w + x];
    if (v && !most) outer[y * w + x] = 1; else if (!v && most) inner[y * w + x] = 1;
  }
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B), blocks = bw * bh, perBlock = mask => {
    const c = new Uint16Array(blocks);
    for (const { at } of spots(mask, w)) c[Math.floor(at / w / B) * bw + Math.floor(at % w / B)]++;
    return c;
  };
  const o = perBlock(outer), n = perBlock(inner);
  const stepped = new Uint8Array(blocks);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const win = [by * bw + bx, by * bw + bx + 1, (by + 1) * bw + bx, (by + 1) * bw + bx + 1].filter((_, k) => bx + (k & 1) < bw && by + (k >> 1) < bh);
    if (Math.min(...[o, n].map(c => win.reduce((a, i) => a + c[i], 0))) >= STAIR) for (const i of win) if (o[i] + n[i]) stepped[i] = 1;
  }
  return { stripes: striped / (cw * ch), jag: stepped.reduce((a, b) => a + b, 0) / blocks };
}
