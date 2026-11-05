// Gray images as data maps over the ground: a terrain height map, a terrain outline mask, a vegetation density map. One reader and one
// sampler, so every map that takes { url | data, width, height, size, center } means the same pixel at the same world spot.
// grayWorld is pure (the terrain worker samples with it); loadGray needs a DOM and runs on the main thread only.

/** Bilinear read of a gray image { data, width, height } at u, v in 0..1 (row 0 of data is v = 0) */
function grayAt(M, u, v) {
  const fx = u * (M.width - 1), fz = v * (M.height - 1), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const at = (a, b) => M.data[Math.min(M.height - 1, b) * M.width + Math.min(M.width - 1, a)];
  return at(i, j) * (1 - tx) * (1 - tz) + at(i + 1, j) * tx * (1 - tz) + at(i, j + 1) * (1 - tx) * tz + at(i + 1, j + 1) * tx * tz;
}

/** The map's value at world x, z, placed by { size, center }; null outside the image (what that means is the caller's: no ground, no plants, the map's floor) */
export function grayWorld(M, x, z) {
  const [sx, sz] = M.size, [cx, cz] = M.center || [0, 0], u = (x - cx) / sx + 0.5, v = (z - cz) / sz + 0.5;
  return u < 0 || u > 1 || v < 0 || v > 1 ? null : grayAt(M, u, v);
}

/** Read a grayscale image (its red channel) into a 0-1 array: { data, width, height } */
export async function loadGray(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data, data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) data[i] = px[i * 4] / 255;
  return { data, width: c.width, height: c.height };
}
