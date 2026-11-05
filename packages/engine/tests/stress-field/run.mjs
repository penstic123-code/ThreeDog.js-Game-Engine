#!/usr/bin/env node
// Field stress driver (maintainer script, not part of `npm test`): runs tests/stress-field/ in SYSTEM Chrome on the real GPU (like tools/real-webgpu.mjs).
//   node packages/engine/tests/stress-field/run.mjs <method> '<json args>' [--backend=webgl] [--no-build] [--headed]
//   methods: env objects churn sceneChurn longStart fly saves modules. One fresh page per call; prints one JSON line (long runs also print each sample row).
// Chrome flags: --disable-frame-rate-limit / --disable-gpu-vsync so a frame is not pinned at 16.7 ms (the page also measures queue-drain throughput itself),
// --js-flags=--expose-gc and --enable-precise-memory-info so the JS heap numbers are exact after a forced gc.
process.env.THREEDOG_TEST = '1';
import { chromium } from 'playwright';
import { buildAndPreview } from '@threedog/tools/browser';
import { ENGINE } from '@threedog/tools/paths';

const args = process.argv.slice(2);
const flag = k => args.includes(`--${k}`);
const value = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const pos = args.filter(a => !a.startsWith('--'));
const method = pos[0] ?? 'env', params = pos[1] ? JSON.parse(pos[1]) : {}, backend = value('backend') ?? 'webgpu';

const server = await buildAndPreview(ENGINE, { build: !flag('no-build') });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--ignore-gpu-blocklist',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    // count GPU devices made / destroyed (WebGPU), validation errors
    const log = window.__gpu = { devices: 0, lost: [], errors: [], adapter: null };
    if (!navigator.gpu) return;
    const ra = GPU.prototype.requestAdapter;
    GPU.prototype.requestAdapter = async function (...a) {
      const ad = await ra.apply(this, a); if (!ad) return ad;
      const i = ad.info; log.adapter = `${i.vendor}/${i.architecture}/${i.description}`;
      const rd = ad.requestDevice;
      ad.requestDevice = async function (...d) { const dev = await rd.apply(this, d); log.devices++; dev.lost.then(l => log.lost.push(l.reason)); dev.addEventListener('uncapturederror', e => { if (log.errors.length < 5) log.errors.push(e.error.message.slice(0, 200)); }); return dev; };
      return ad;
    };
  });
  await page.goto(`${server.base}/tests/stress-field/index.html?backend=${backend}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.sfReady, null, { timeout: 120000 });
  const renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; });
  let poll;
  if (method === 'longStart') poll = setInterval(async () => { try { const r = await page.evaluate(() => window.rows?.at(-1)); if (r) console.error(JSON.stringify(r)); } catch {} }, 60000);
  page.setDefaultTimeout(0);
  const t0 = Date.now();
  const result = await page.evaluate(([m, p]) => window.sf[m](p), [method, params]);
  clearInterval(poll);
  const gpu = await page.evaluate(() => window.__gpu);
  console.log(JSON.stringify({ method, backend, params, wallS: Math.round((Date.now() - t0) / 1000), webglRenderer: renderer, gpu, errors: [...new Set(errors)].slice(0, 6), result }));
} catch (e) {
  console.log(JSON.stringify({ method, backend, params, failed: String(e?.message ?? e).split('\n')[0] }));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await server.close();
}
