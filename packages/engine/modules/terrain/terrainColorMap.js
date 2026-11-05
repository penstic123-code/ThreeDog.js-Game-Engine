// Terrain color map (shading: 'texture'): one RGBA8 image per chunk, colored pixel by pixel with the same rules as the vertex colors
// (faceColor: ground type, steep slopes, noise blend, jitter, patches; painted cells), so a color border (a river bank) is no longer
// confined to triangle edges. Pure computation, no three.js: runs in the Worker next to buildChunk.
//
// Layout: (R + 2)^2 pixels, R = colorResolution. Pixel k (0..R+1) sits at world x = chunkOrigin + (k - 1 + 0.5) * CHUNK / R, so the
// image has a 1-pixel border around the chunk. A border pixel is computed from world coordinates, which means the neighbor chunk
// computes the identical value at the same place: linear filtering at the chunk edge then reads the same numbers on both sides (no seam).
// Values are stored sRGB-encoded (the texture is uploaded with colorSpace sRGB), which keeps dark greens from banding in 8 bits.

const toSRGB = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** @returns {(cx: number, cz: number) => { data: Uint8Array, size: number }} */
// inside(x, z) (terrain({ shape }) only): a void pixel keeps the color of the ground under it (so filtering at the rim stays seamless)
// and gets alpha 0, which a game's own shader may read
export function makeColorMap({ cfg, CHUNK, CELL, surface, faceColor, paintColor, cellType, gridNormal, inside = null }) {
  const R = Math.max(2, Math.round(cfg.colorResolution)), S = R + 2, step = CHUNK / R;
  // sRGB encode through a table: 4096 steps are finer than 8 bits can show
  const LUT = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) LUT[i] = Math.round(255 * toSRGB(i / 4096));
  const enc = v => LUT[v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096 + 0.5) | 0];
  // keep { data, i0, i1, j0, j1 } (an edit): repaint in place only the pixels in those cells; the rest of data is already right
  return function colorMap(cx, cz, keep = null) {
    const data = keep?.data ?? new Uint8Array(S * S * 4), tmp = [0, 0, 0], ox = cx * CHUNK, oz = cz * CHUNK;
    const ny = new Map();   // grid-point normal.y, shared by the pixels of a cell
    const gny = (i, j) => { const k = i * 100003 + j; let v = ny.get(k); if (v === undefined) ny.set(k, v = gridNormal(i, j)[1]); return v; };
    let o = 0;
    for (let pj = 0; pj < S; pj++) {
      const z = oz + (pj - 0.5) * step, j = Math.floor(z / CELL), fz = z / CELL - j;
      for (let pi = 0; pi < S; pi++, o += 4) {
        const x = ox + (pi - 0.5) * step, i = Math.floor(x / CELL), fx = x / CELL - i;
        if (keep && (i < keep.i0 || i > keep.i1 || j < keep.j0 || j > keep.j1)) continue;
        const pt = cellType(i, j);
        if (pt !== undefined) paintColor(pt, (i + 0.5) * CELL, (j + 0.5) * CELL, tmp);   // a painted cell is one color, like its vertices
        else {
          // steep-slope tests use the normal interpolated between the 4 grid points, so they do not follow triangle edges either
          const n = (gny(i, j) * (1 - fx) + gny(i + 1, j) * fx) * (1 - fz) + (gny(i, j + 1) * (1 - fx) + gny(i + 1, j + 1) * fx) * fz;
          faceColor(surface(x, z), n, x, z, tmp);
        }
        data[o] = enc(tmp[0]); data[o + 1] = enc(tmp[1]); data[o + 2] = enc(tmp[2]); data[o + 3] = inside && !inside(x, z) ? 0 : 255;
      }
    }
    return { data, size: S };
  };
}
