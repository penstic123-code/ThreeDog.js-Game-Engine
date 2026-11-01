// sampleGrid (nearest / linear / cubic, edges, outside), gridFromPixels and decodePng on small PNGs built in the test (no browser).
import { deflateSync } from 'node:zlib';
import { sampleGrid, gridFromPixels, decodePng } from 'threedog/grid';

export const name = 'grid: sampleGrid interpolation and edges, PNG grids (8 / 16 bit, channels)';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const crc = () => 0;   // decodePng does not verify checksums, so the test chunks carry zeros
function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0); out.write(type, 4, 'latin1'); body.copy(out, 8); out.writeUInt32BE(crc(), 8 + body.length);
  return out;
}
/** rows: array of Buffers with the filter byte first */
function png(width, height, bitDepth, colorType, rows) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = bitDepth; ihdr[9] = colorType;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]));
}

export async function run({ check }) {
  // 3 x 2 nodes, cell 10: z rows 0 and 10
  const d = [0, 10, 20, 100, 110, 120], base = { width: 3, height: 2, cellSize: 10 };
  const lin = sampleGrid(d, base), nea = sampleGrid(d, { ...base, interp: 'nearest' }), cub = sampleGrid(d, { ...base, interp: 'cubic' });
  check('linear: exact at nodes', near(lin(0, 0), 0) && near(lin(10, 0), 10) && near(lin(20, 10), 120));
  check('linear: halfway along x and z', near(lin(5, 0), 5) && near(lin(0, 5), 50) && near(lin(5, 5), 55));
  check('nearest: flat steps, rounds to the closest node', nea(4, 4) === 0 && nea(6, 4) === 10 && nea(6, 6) === 110);
  const plane = Array.from({ length: 16 }, (_, k) => (k % 4) * 2 + Math.floor(k / 4) * 3), pc = sampleGrid(plane, { width: 4, height: 4, cellSize: 1, interp: 'cubic' });
  check('cubic: exact at nodes, reproduces a tilted plane inside the grid', near(cub(10, 0), 10) && near(pc(1.5, 1.25), 1.5 * 2 + 1.25 * 3, 1e-5));
  check('size gives the same spacing as cellSize', near(sampleGrid(d, { width: 3, height: 2, size: [20, 10] })(5, 5), 55));
  check('origin shifts the grid', near(sampleGrid(d, { ...base, origin: [-10, -10] })(-5, -5), 55));
  check('edges: clamped to the nearest edge value by default', near(lin(-50, 0), 0) && near(lin(500, 0), 20) && near(lin(0, 99), 100));
  check('outside: a number is returned beyond the grid, edge values inside', lin(0, 0) === 0 && sampleGrid(d, { ...base, outside: -7 })(-1, 0) === -7 && sampleGrid(d, { ...base, outside: -7 })(20, 10) === 120);
  // a step: cubic overshoots next to it, clamp keeps the corner range
  const step = [0, 0, 100, 100, 100], sb = { width: 5, height: 1, cellSize: 1 };
  const over = sampleGrid(step, { ...sb, interp: 'cubic' }), held = sampleGrid(step, { ...sb, interp: 'cubic', clamp: true });
  check('cubic overshoots a sharp step', over(2.5, 0) > 100);
  check('cubic clamp: stays inside the corner range', [1.1, 1.5, 2.5, 3.2].every(x => held(x, 0) >= 0 && held(x, 0) <= 100));
  check('1 x 1 grid is a constant', sampleGrid([3], { width: 1, height: 1, cellSize: 1 })(9, 9) === 3);
  let msg = ''; try { sampleGrid([1, 2], { width: 3, height: 1, cellSize: 1 }); } catch (e) { msg = e.message; }
  check('too little data throws with the numbers', /2 values.*3/.test(msg));
  msg = ''; try { sampleGrid([1], { width: 1, height: 1 }); } catch (e) { msg = e.message; }
  check('no cellSize / size throws', /cellSize/.test(msg));

  // 8-bit grayscale 3 x 2: row 0 plain, row 1 stored with the Up filter (adds the row above)
  const g8 = png(3, 2, 8, 0, [Buffer.from([0, 0, 128, 255]), Buffer.from([2, 10, 10, 0])]);
  const px8 = await decodePng(g8);
  check('PNG 8-bit gray: size, channels, samples (Up filter undone)', px8.width === 3 && px8.height === 2 && px8.channels === 1 && [...px8.samples].join() === '0,128,255,10,138,255', [...px8.samples].join());
  const grid8 = gridFromPixels(px8, { range: [0, 255] });
  check('grid from 8-bit: range maps 0..255', near(grid8.data[1], 128) && grid8.bits === 8);
  // 16-bit grayscale 2 x 1: 0x0100 and 0xFFFF
  const px16 = await decodePng(png(2, 1, 16, 0, [Buffer.from([0, 0x01, 0x00, 0xff, 0xff])]));
  check('PNG 16-bit gray: full 16-bit samples', px16.bitDepth === 16 && px16.samples[0] === 256 && px16.samples[1] === 65535);
  const g16 = gridFromPixels(px16, { range: [-5, 60] });
  check('grid from 16-bit: keeps precision (256/65535 steps)', near(g16.data[0], -5 + (256 / 65535) * 65, 1e-4) && near(g16.data[1], 60, 1e-4) && g16.bits === 16);
  check('bits: 8 on a 16-bit file reads the high byte only', near(gridFromPixels(px16, { bits: 8 }).data[0], 1 / 255));
  // RGBA 1 x 1, channel pick (green) and a missing channel
  const rgba = await decodePng(png(1, 1, 8, 6, [Buffer.from([0, 10, 255, 30, 255])]));
  check('RGBA: channel g picks the second value', gridFromPixels(rgba, { channel: 'g', range: [0, 255] }).data[0] === 255 && gridFromPixels(rgba, { channel: 3, range: [0, 255] }).data[0] === 255);
  msg = ''; try { gridFromPixels(px8, { channel: 'g' }); } catch (e) { msg = e.message; }
  check('a channel the image lacks throws', /1 channel/.test(msg));
  msg = ''; try { await decodePng(new Uint8Array([1, 2, 3])); } catch (e) { msg = e.message; }
  check('not a PNG throws', /not a PNG/.test(msg));
  // sampled from an image grid end to end
  const hm = sampleGrid(grid8.data, { ...grid8, size: [2, 1] });
  check('image grid plugs into sampleGrid', near(hm(1, 0), 128) && near(hm(0.5, 0), 64));
}
