// Load an image file as grid data (assets.gridFromImage). PNG is decoded by decodePng (full 8 or 16 bits); other formats (jpg, webp) go through a
// canvas, which gives 8 bits per channel. Kept apart from grid.js because it needs fetch / DOM, grid.js does not.
import { decodePng, gridFromPixels } from './grid.js';
import { codedError } from './errorHints.js';

/**
 * @param {string} url
 * @param {{ channel?: 'r' | 'g' | 'b' | 'a' | number, range?: [number, number], bits?: 8 | 16 }} [opts]
 */
export async function loadGrid(url, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw codedError('grid-data', `gridFromImage: could not load ${url} (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return gridFromPixels(await decodePng(bytes), opts);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  const samples = g.getImageData(0, 0, bmp.width, bmp.height).data;
  return gridFromPixels({ samples, width: bmp.width, height: bmp.height, channels: 4, bitDepth: 8 }, opts);
}
