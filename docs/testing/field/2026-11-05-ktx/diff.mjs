// Mean difference between the two screenshots, model pixels only (background gray skipped). Usage (repo root): node docs/testing/field/2026-11-05-ktx/diff.mjs [dir]
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const sharp = createRequire(resolve(process.cwd(), 'package.json'))('sharp'), d = (process.argv[2] ?? 'docs/testing/field/2026-11-05-ktx') + '/';
const a = (await sharp(d + 'index_html_m_orig.png').removeAlpha().raw().toBuffer()), b = await sharp(d + 'index_html_m_opt.png').removeAlpha().raw().toBuffer();
let s = 0, sa = 0, sb = 0, n = 0, big = 0;
for (let i = 0; i < a.length; i += 3) {
  const x = (a[i] + a[i + 1] + a[i + 2]) / 3, y = (b[i] + b[i + 1] + b[i + 2]) / 3;
  if (Math.abs(a[i] - 145) < 3 && Math.abs(b[i] - 145) < 3 && Math.abs(a[i + 1] - a[i]) < 3) continue;   // flat gray background
  n++; s += Math.abs(x - y); sa += x; sb += y; if (Math.abs(x - y) > 24) big++;
}
console.log(JSON.stringify({ modelPixels: n, meanAbsDiff: +(s / n).toFixed(2), meanBrightnessOriginal: +(sa / n).toFixed(1), meanBrightnessOptimized: +(sb / n).toFixed(1), pctPixelsOver24: +(big / n * 100).toFixed(1) }));
