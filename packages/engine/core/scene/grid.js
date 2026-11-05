import { codedError } from '../base/errorHints.js';
// 2D grid fields: sampleGrid turns an array of numbers laid out on a regular grid into a function (x, z) -> value, and gridFromPixels / decodePng read
// an image into such an array. A grid can hold any field of the ground plane: height, moisture, ground-type weight, density, a walkable mask, danger, cost.
// No three.js and no DOM here (DecompressionStream exists in browsers and Node), so it runs in tests and workers alike.

const CHANNELS = { r: 0, g: 1, b: 2, a: 3 };

/**
 * Turn grid data into a function (x, z) -> value in world units.
 * data[j * width + i] is the value at world (origin[0] + i * cell, origin[1] + j * cell): samples sit on the grid nodes, so a grid of
 * `width` samples spans (width - 1) cells. Give the node spacing as cellSize (a number, or [sx, sz]) or the whole extent as size [sx, sz].
 * Outside the grid the nearest edge value is used, or `outside` when given (a number, e.g. a sea-floor height or 0 for "not walkable").
 *
 * interp picks the look of the field between nodes (none of them is the right one; they suit different looks):
 *   'nearest' flat steps, one value per cell: blocky or terraced ground, tile-like masks, ids stored as numbers
 *   'linear'  (default) plain bilinear blend: smooth enough for most fields, cheap, never leaves the range of the four corners
 *   'cubic'   Catmull-Rom bicubic: smooth slopes without visible cell creases; it can overshoot near sharp steps, clamp: true keeps the result
 *             inside the range of the four corner samples
 * @param {ArrayLike<number>} data
 * @param {{ width: number, height: number, cellSize?: number | [number, number], size?: [number, number], origin?: [number, number],
 *   interp?: 'nearest' | 'linear' | 'cubic', clamp?: boolean, outside?: number }} opts
 * @returns {(x: number, z: number) => number}
 * @example const wet = sampleGrid(moisture, { width: 64, height: 64, size: [256, 256], origin: [-128, -128] });  wet(12, -40)
 */
export function sampleGrid(data, opts = {}) {
  const { width, height, interp = 'linear', clamp = false, outside } = opts;
  if (!data || !(width >= 1) || !(height >= 1) || !Number.isInteger(width) || !Number.isInteger(height)) throw codedError('grid-data', `sampleGrid(data, { width, height }): data is a list and width and height are whole numbers >= 1, got ${data ? `width ${width}, height ${height}` : data}`);
  if (data.length < width * height) throw codedError('grid-data', `sampleGrid: data has ${data.length} values, but width * height is ${width * height}`);
  if (!['nearest', 'linear', 'cubic'].includes(interp)) throw codedError('grid-data', `sampleGrid: interp '${interp}' is not one of 'nearest', 'linear', 'cubic'`);
  const [ox, oz] = opts.origin || [0, 0];
  let cx, cz;
  if (opts.size) { cx = opts.size[0] / Math.max(1, width - 1); cz = opts.size[1] / Math.max(1, height - 1); }
  else if (Array.isArray(opts.cellSize)) [cx, cz] = opts.cellSize;
  else if (opts.cellSize != null) cx = cz = opts.cellSize;
  else throw codedError('grid-data', 'sampleGrid: give cellSize (node spacing in world units) or size: [sx, sz] (the whole extent)');
  if (!(cx > 0) || !(cz > 0)) throw codedError('grid-data', `sampleGrid: cellSize / size must be greater than 0, got ${cx} x ${cz}`);
  const W = width, H = height, at = (i, j) => data[(j < 0 ? 0 : j >= H ? H - 1 : j) * W + (i < 0 ? 0 : i >= W ? W - 1 : i)];
  const hasOut = typeof outside === 'number';
  // Catmull-Rom weights through p0..p3 at t in [0, 1] (passes through p1 at 0 and p2 at 1)
  const cr = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
  return (x, z) => {
    const gx = (x - ox) / cx, gz = (z - oz) / cz;
    if (hasOut && (gx < 0 || gz < 0 || gx > W - 1 || gz > H - 1)) return outside;
    if (interp === 'nearest') return at(Math.round(gx), Math.round(gz));
    const fx = Math.floor(gx), fz = Math.floor(gz), tx = gx - fx, tz = gz - fz;
    const a = at(fx, fz), b = at(fx + 1, fz), c = at(fx, fz + 1), d = at(fx + 1, fz + 1);
    if (interp === 'linear') return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    const row = j => cr(at(fx - 1, j), at(fx, j), at(fx + 1, j), at(fx + 2, j), tx);
    const v = cr(row(fz - 1), row(fz), row(fz + 1), row(fz + 2), tz);
    return clamp ? Math.min(Math.max(v, Math.min(a, b, c, d)), Math.max(a, b, c, d)) : v;
  };
}

/** Channel name or index -> index (r g b a, or 0-3) */
function channelIndex(channel) {
  const i = typeof channel === 'string' ? CHANNELS[channel.toLowerCase()] : channel;
  if (!Number.isInteger(i) || i < 0 || i > 3) throw codedError('grid-data', `gridFromImage: channel '${channel}' is not 'r', 'g', 'b', 'a' or 0-3`);
  return i;
}

/**
 * Pixels -> grid data. samples is the interleaved channel array of an image (Uint8Array, or Uint16Array for 16-bit), channels per pixel as given.
 * Values map linearly from 0..maxValue to range [min, max] (default [0, 1]).
 * @param {{ samples: ArrayLike<number>, width: number, height: number, channels: number, bitDepth: number }} img
 * @param {{ channel?: 'r' | 'g' | 'b' | 'a' | number, range?: [number, number], bits?: 8 | 16 }} [opts]
 * @returns {{ data: Float32Array, width: number, height: number, bits: number }}
 */
export function gridFromPixels(img, { channel = 0, range = [0, 1], bits } = {}) {
  const ch = channelIndex(channel), n = img.width * img.height, bd = img.bitDepth;
  if (ch >= img.channels) throw codedError('grid-data', `gridFromImage: the image has ${img.channels} channel(s), so channel ${ch} does not exist`);
  const want = bits ?? (bd === 16 ? 16 : 8);
  if (want !== 8 && want !== 16) throw codedError('grid-data', `gridFromImage: bits is 8 or 16, got ${want}`);
  const [lo, hi] = range, data = new Float32Array(n);
  // asking for 8 bits from a 16-bit image keeps only the high byte (the stepped look of an 8-bit file); asking for 16 from 8 bits just stretches it
  const shift = bd === 16 && want === 8 ? 8 : 0, max = want === 16 ? 65535 : 255, src = img.samples;
  for (let i = 0; i < n; i++) {
    let v = src[i * img.channels + ch];
    if (shift) v >>= shift; else if (bd === 8 && want === 16) v *= 257;
    data[i] = lo + (v / max) * (hi - lo);
  }
  return { data, width: img.width, height: img.height, bits: want };
}

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Decode a PNG (not interlaced; grayscale, gray+alpha, RGB, RGBA, 8 or 16 bits). Browsers' canvas flattens 16-bit images to 8, so height maps that
 * need the full 16 bits are read here. Palette images and interlaced files throw with the way out.
 * @param {Uint8Array | ArrayBuffer} input
 * @returns {Promise<{ samples: Uint8Array | Uint16Array, width: number, height: number, channels: number, bitDepth: number }>}
 */
export async function decodePng(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 33 || dv.getUint32(0) !== 0x89504e47) throw codedError('grid-data', 'decodePng: not a PNG file');
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0, p = 8;
  const idat = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]), d = p + 8;
    if (type === 'IHDR') { width = dv.getUint32(d); height = dv.getUint32(d + 4); bitDepth = b[d + 8]; colorType = b[d + 9]; interlace = b[d + 12]; }
    else if (type === 'IDAT') idat.push(b.subarray(d, d + len));
    else if (type === 'IEND') break;
    p = d + len + 4;
  }
  if (interlace) throw codedError('grid-data', 'decodePng: interlaced PNG is not supported; save it without interlacing');
  if (colorType === 3) throw codedError('grid-data', 'decodePng: palette PNG is not supported; save it as grayscale or RGB');
  if (bitDepth !== 8 && bitDepth !== 16) throw codedError('grid-data', `decodePng: ${bitDepth}-bit PNG is not supported; use 8 or 16 bits per channel`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw codedError('grid-data', `decodePng: color type ${colorType} is not supported`);
  const all = new Uint8Array(idat.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of idat) { all.set(c, o); o += c.length; }
  const raw = await inflate(all), bpp = channels * bitDepth / 8, stride = width * bpp, out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, r = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[r + x - bpp] : 0, up = y ? out[r - stride + x] : 0, c = x >= bpp && y ? out[r - stride + x - bpp] : 0, v = raw[s + x];
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = up; else if (f === 3) add = (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[r + x] = (v + add) & 255;
    }
  }
  let samples = out;
  if (bitDepth === 16) { samples = new Uint16Array(width * height * channels); for (let i = 0; i < samples.length; i++) samples[i] = (out[i * 2] << 8) | out[i * 2 + 1]; }
  return { samples, width, height, channels, bitDepth };
}
