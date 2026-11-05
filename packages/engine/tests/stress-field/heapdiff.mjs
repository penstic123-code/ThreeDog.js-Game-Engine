#!/usr/bin/env node
// Heap diff of a terrain flight (maintainer script, not part of `npm test`): is the JS heap growth real, and which objects are it?
//   node packages/engine/tests/stress-field/heapdiff.mjs <outDir> '{"view":4,"speed":250,"seconds":10,"segments":3}' [--backend=webgl] [--no-build] [--snapshots]
//   node packages/engine/tests/stress-field/heapdiff.mjs <outDir> --records [--no-build]   the WebGPU record sweep instead of a flight: its cost, and a plain three.js scene's heap with it on and off
// Prints the heap after a forced gc for each segment; with --snapshots also a CDP heap snapshot after the first and the last segment and the biggest
// growth by constructor. A snapshot runs a full gc itself, so what the diff shows survived gc. Why from the first segment and not before it: the first
// shaders, pipelines and caches land there and would read as growth.
process.env.THREEDOG_TEST = '1';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { buildAndPreview } from '@threedog/tools/browser';
import { ENGINE } from '@threedog/tools/paths';

const args = process.argv.slice(2);
const flag = k => args.includes(`--${k}`);
const value = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const [outDir, json] = args.filter(a => !a.startsWith('--'));
const { view = 4, speed = 250, seconds = 10, segments = 3 } = JSON.parse(json ?? '{}');
const backend = value('backend') ?? 'webgpu';
mkdirSync(outDir, { recursive: true });

/** One snapshot file -> Map 'type:name' -> { count, size } */
function summarize(file) {
  const snap = JSON.parse(readFileSync(file, 'utf8')), meta = snap.snapshot.meta, F = meta.node_fields, N = F.length;
  const iT = F.indexOf('type'), iN = F.indexOf('name'), iS = F.indexOf('self_size'), types = meta.node_types[iT], out = new Map();
  for (let i = 0; i < snap.nodes.length; i += N) {
    const t = types[snap.nodes[i + iT]];
    let name = snap.strings[snap.nodes[i + iN]];
    if (t === 'string' || t === 'concatenated string' || t === 'sliced string') name = '(strings)';
    else if (t === 'number') name = '(numbers)';
    else if (t === 'code' || t === 'hidden') name = `(${t})`;
    const k = `${t}:${name.slice(0, 60)}`, r = out.get(k) ?? { count: 0, size: 0 };
    r.count++; r.size += snap.nodes[i + iS]; out.set(k, r);
  }
  return out;
}

const server = await buildAndPreview(ENGINE, { build: !flag('no-build') });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--ignore-gpu-blocklist',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${server.base}/tests/stress-field/index.html?backend=${backend}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.sfReady, null, { timeout: 120000 });
  page.setDefaultTimeout(0);
  const cdp = await page.context().newCDPSession(page);
  const snapshot = async name => {
    const file = join(outDir, `${backend}-${name}.heapsnapshot`), w = createWriteStream(file);
    const chunk = ({ chunk }) => w.write(chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', chunk);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', chunk);
    await new Promise(r => w.end(r));
    return file;
  };
  if (flag('records')) {
    const fresh = async (name, p) => {   // one page per measure: an engine disposed on the canvas ends it, and each heap starts clean
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.sfReady);
      console.log(JSON.stringify(await page.evaluate(([n, a]) => window.sf[n](a), [name, p])));
    };
    for (const n of [1000, 5000, 20000]) await fresh('sweepCost', { n });
    for (const disposeGeometry of [true, false]) for (const sweep of [false, true]) await fresh('plainDrop', { sweep, disposeGeometry });
    await fresh('poolReturn', {});
    if (errors.length) console.log('page errors:', [...new Set(errors)].slice(0, 5));
    await browser.close(); await server.close(); process.exit(0);
  }
  const start = await page.evaluate(p => window.sf.flyBegin(p), { view });
  console.log(JSON.stringify({ backend, view, speed, seconds, heapStart: start, device: await page.evaluate(() => window.engine.describe().renderer?.backend) }));
  let first, last, km = 0;
  for (let i = 1; i <= segments; i++) {
    const r = await page.evaluate(p => window.sf.flySegment(p), { speed, seconds });
    km += r.distance / 1000;
    console.log(JSON.stringify({ segment: i, km: Math.round(km * 10) / 10, heapMB: r.heapEnd, chunks: r.chunks, geometries: r.geometries, textures: r.textures, medianMs: r.medianMs }));
    if (flag('snapshots') && i === 1) first = await snapshot('first');
    if (flag('snapshots') && i === segments) last = await snapshot('last');
  }
  if (errors.length) console.log('page errors:', [...new Set(errors)].slice(0, 5));
  if (first && last) {
    const a = summarize(first), b = summarize(last), rows = [];
    for (const [k, r] of b) { const o = a.get(k) ?? { count: 0, size: 0 }; rows.push({ k, count: r.count - o.count, kb: Math.round((r.size - o.size) / 1024) }); }
    rows.sort((x, y) => y.kb - x.kb);
    console.log('growth by constructor, first -> last snapshot:');
    for (const r of rows.slice(0, 30)) console.log(String(r.kb).padStart(9), 'KB', String(r.count).padStart(8), r.k);
  }
} finally {
  await browser?.close().catch(() => {});
  await server.close();
}
