#!/usr/bin/env node
// Field stress driver (maintainer script, not part of `npm test`): runs tests/stress-field/ in SYSTEM Chrome on the real GPU (like tools/real-webgpu.mjs).
//   node packages/engine/tests/stress-field/run.mjs <method> '<json args>' [--backend=webgl|webgpu-gl] [--no-build] [--headed] [--cpuprofile=<seconds>] [--profile-out=<file>] [--gputime=<every nth frame>] [--trace=<seconds>] [--trace-out=<file>] [--shot=<file>]
//   webgpu-gl: three's WebGPURenderer on its WebGL2 backend, the middle step between webgl (WebGLRenderer) and webgpu: same renderer as webgpu, same driver road as webgl.
//   --gputime: real GPU time per pass from timestamp queries (WebGPU) or EXT_disjoint_timer_query_webgl2 around the draw (WebGL2). --trace: a Chrome trace over that many seconds of the path, the only view of the GPU process.
//   methods: env objects churn sceneChurn longStart fly saves modules city. One fresh page per call; prints one JSON line (long runs also print each sample row).
// Chrome flags: --disable-frame-rate-limit / --disable-gpu-vsync so a frame is not pinned at 16.7 ms (the page also measures queue-drain throughput itself),
// --js-flags=--expose-gc and --enable-precise-memory-info so the JS heap numbers are exact after a forced gc.
process.env.THREEDOG_TEST = '1';
import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildAndPreview } from '@threedog/tools/browser';
import { ENGINE } from '@threedog/tools/paths';

// True VRAM of this run's Chrome GPU process from the Windows GPU counters (the browser has no API for it). The tag finds our browser among other agents' Chromes.
const TAG = 'threedog-field-' + process.pid;
const ps = cmd => new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 20000 }, (err, out) => res(err ? '' : out.trim())));
let gpuPid = null;
async function vram() {
  gpuPid ??= (await ps(`$b = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${TAG}*' } | Select-Object -First 1; (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($b.ProcessId)" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' } | Select-Object -First 1).ProcessId`)) || null;
  if (!gpuPid) return null;
  const mb = await ps(`[math]::Round(((Get-Counter "\\GPU Process Memory(pid_${gpuPid}_*)\\Dedicated Usage").CounterSamples | Measure-Object CookedValue -Sum).Sum / 1MB, 1)`);
  return mb ? Number(mb) : null;
}

const args = process.argv.slice(2);
const flag = k => args.includes(`--${k}`);
const value = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const pos = args.filter(a => !a.startsWith('--'));
const method = pos[0] ?? 'env', params = pos[1] ? JSON.parse(pos[1]) : {}, backend = value('backend') ?? 'webgpu';

const server = await buildAndPreview(ENGINE, { build: !flag('no-build') });
let browser, poll, vramPoll;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed'), args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--ignore-gpu-blocklist',
    '--disable-frame-rate-limit', '--disable-gpu-vsync', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--${TAG}`] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)); });
  await page.addInitScript(() => {
    // count GPU devices made / destroyed (WebGPU), validation errors
    const log = window.__gpu = { devices: 0, lost: [], errors: [], adapter: null, fallback: null, draws: 0, passes: 0, bytes: 0 };
    if (!navigator.gpu) return;
    // real draws per frame: renderer.info.render.calls does not count WebGPU draws in these scenes, so count on the encoders
    for (const P of [GPURenderPassEncoder.prototype, GPURenderBundleEncoder.prototype]) for (const k of ['draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect']) { const f = P[k]; P[k] = function (...a) { log.draws++; return f.apply(this, a); }; }
    const bp = GPUCommandEncoder.prototype.beginRenderPass; GPUCommandEncoder.prototype.beginRenderPass = function (...a) { log.passes++; return bp.apply(this, a); };
    // bytes the page asked the GPU for, live: a page-side view beside the true VRAM counter (vram() above); texture size assumes 4 bytes a texel plus mips
    const sizes = new WeakMap(), track = (o, n) => { sizes.set(o, n); log.bytes += n; return o; };
    const cb = GPUDevice.prototype.createBuffer; GPUDevice.prototype.createBuffer = function (d) { return track(cb.call(this, d), d.size); };
    const ct = GPUDevice.prototype.createTexture; GPUDevice.prototype.createTexture = function (d) { const s = d.size, w = s.width ?? s[0], h = s.height ?? s[1] ?? 1, l = s.depthOrArrayLayers ?? s[2] ?? 1; return track(ct.call(this, d), w * h * l * 4 * (d.sampleCount ?? 1) * ((d.mipLevelCount ?? 1) > 1 ? 1.34 : 1)); };
    for (const P of [GPUBuffer.prototype, GPUTexture.prototype]) { const f = P.destroy; P.destroy = function () { log.bytes -= sizes.get(this) ?? 0; sizes.delete(this); return f.call(this); }; }
    // what the byte count above cannot see, for a VRAM growth it does not explain: live buffers, bind groups (no destroy(): they go with the JS garbage collector), pipelines, upload volume
    Object.assign(log, { buffers: 0, bindGroups: 0, bindGroupsLive: 0, pipelines: 0, uploadMB: 0 });
    const gone = new FinalizationRegistry(() => { log.bindGroupsLive--; });
    const bg = GPUDevice.prototype.createBindGroup; GPUDevice.prototype.createBindGroup = function (d) { const o = bg.call(this, d); log.bindGroups++; log.bindGroupsLive++; gone.register(o, 0); return o; };
    for (const k of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline']) { const f = GPUDevice.prototype[k]; GPUDevice.prototype[k] = function (d) { log.pipelines++; return f.call(this, d); }; }
    const wb = GPUQueue.prototype.writeBuffer; GPUQueue.prototype.writeBuffer = function (b, o, d, ...r) { log.uploadMB += (r[1] ?? d.byteLength) * (d.BYTES_PER_ELEMENT ?? 1) / 1048576; return wb.call(this, b, o, d, ...r); };
    log.kinds = {}; const kind = (b, n) => { const k = `${b.usage}:${b.size}`; log.kinds[k] = (log.kinds[k] ?? 0) + n; };
    const cb2 = GPUDevice.prototype.createBuffer; GPUDevice.prototype.createBuffer = function (d) { log.buffers++; const b = cb2.call(this, d); kind(b, 1); return b; };
    const bd = GPUBuffer.prototype.destroy; GPUBuffer.prototype.destroy = function () { log.buffers--; kind(this, -1); return bd.call(this); };
    const ra = GPU.prototype.requestAdapter;
    GPU.prototype.requestAdapter = async function (...a) {
      const ad = await ra.apply(this, a); if (!ad) return ad;
      const i = ad.info; log.adapter = `${i.vendor}/${i.architecture}/${i.description}`; log.fallback = i.isFallbackAdapter ?? null;
      const rd = ad.requestDevice;
      ad.requestDevice = async function (...d) { const dev = await rd.apply(this, d); log.devices++; dev.lost.then(l => log.lost.push(l.reason)); dev.addEventListener('uncapturederror', e => { if (log.errors.length < 5) log.errors.push(e.error.message.slice(0, 200)); }); return dev; };
      return ad;
    };
  });
  // Timestamp writes added to every pass of every nth frame, read back asynchronously: the wrapper sees all passes, including the shadow ones three renders on its own encoder.
  // The page's frame number comes from a rAF of our own, so a pass lands in the frame that encoded it, whichever call encoded it.
  if (value('gputime')) await page.addInitScript(every => {
    const T = window.__gpuTime = { frame: 0, every, rows: [] }, pool = [], waiting = [], open = new WeakMap();
    const count = () => { T.frame++; requestAnimationFrame(count); }; requestAnimationFrame(count);
    let device = null;
    const ce = GPUDevice.prototype.createCommandEncoder; GPUDevice.prototype.createCommandEncoder = function (d) { device = this; return ce.call(this, d); };
    const slot = () => pool.pop() ?? { set: device.createQuerySet({ type: 'timestamp', count: 32 }), res: device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }), read: device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), n: 0 };
    for (const k of ['beginRenderPass', 'beginComputePass']) { const f = GPUCommandEncoder.prototype[k]; GPUCommandEncoder.prototype[k] = function (d = {}) {
      if (T.frame % every || d.timestampWrites) return f.call(this, d);
      let s = open.get(this); if (!s) { s = slot(); s.n = 0; s.frame = T.frame; open.set(this, s); }
      if (s.n >= 32) return f.call(this, d);
      const pass = f.call(this, { ...d, timestampWrites: { querySet: s.set, beginningOfPassWriteIndex: s.n, endOfPassWriteIndex: s.n + 1 } }); s.n += 2; return pass;
    }; }
    const fin = GPUCommandEncoder.prototype.finish; GPUCommandEncoder.prototype.finish = function (d) {
      const s = open.get(this); if (s) { this.resolveQuerySet(s.set, 0, s.n, s.res, 0); this.copyBufferToBuffer(s.res, 0, s.read, 0, 256); waiting.push(s); open.delete(this); }
      return fin.call(this, d);
    };
    const sub = GPUQueue.prototype.submit; GPUQueue.prototype.submit = function (c) {
      const r = sub.call(this, c);
      for (const s of waiting.splice(0)) s.read.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(s.read.getMappedRange()); for (let i = 0; i < s.n; i += 2) T.rows.push([s.frame, Number(t[i]) / 1e6, Number(t[i + 1]) / 1e6]);
        s.read.unmap(); pool.push(s);
      });
      return r;
    };
  }, Number(value('gputime')));
  await page.goto(`${server.base}/tests/stress-field/index.html?backend=${backend}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.sfReady, null, { timeout: 120000 });
  const renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; });

  if (method === 'longStart' || method === 'city' || method === 'soak') poll = setInterval(async () => { try { const r = await page.evaluate(() => window.cityStage?.() ?? window.soakRows?.at(-1) ?? window.rows?.at(-1)); if (r) console.error(JSON.stringify(r)); } catch {} }, method === 'city' ? 10000 : 60000);
  page.setDefaultTimeout(0);
  const t0 = Date.now(), vramRows = [];
  vramPoll = method === 'city' || method === 'soak' ? setInterval(async () => {
    const mb = await vram(); if (mb == null) return;
    const at = await page.evaluate(() => { const c = window.cityStage?.(), g = window.__gpu; return { stage: c?.stage, frames: c?.frames, buffers: g.buffers, bg: g.bindGroups, bgLive: g.bindGroupsLive, pipelines: g.pipelines, uploadMB: Math.round(g.uploadMB) }; }).catch(() => ({}));
    vramRows.push({ s: Math.round((Date.now() - t0) / 1000), mb, ...at });
  }, 15000) : null;
  // --cpuprofile=<seconds>: sample the page's JS while the path runs and print the functions with the most self time to stderr (something to act on, not a guess)
  const prof = value('cpuprofile') && (async () => {
    const c = await page.context().newCDPSession(page);
    while (!(await page.evaluate(() => window.cityStage?.().stage === 'path'))) await new Promise(r => setTimeout(r, 300));
    await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 500 }); await c.send('Profiler.start');
    await new Promise(r => setTimeout(r, Number(value('cpuprofile')) * 1000));
    const { profile: p } = await c.send('Profiler.stop');
    if (value('profile-out')) writeFileSync(value('profile-out'), JSON.stringify(p));
    const self = new Map(), byId = new Map(p.nodes.map(n => [n.id, n])); let total = 0;
    p.samples.forEach((id, i) => { const f = byId.get(id).callFrame, k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`; self.set(k, (self.get(k) ?? 0) + p.timeDeltas[i]); total += p.timeDeltas[i]; });
    console.error(JSON.stringify({ profileMs: Math.round(total / 1000), top: [...self].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([k, us]) => `${(us / total * 100).toFixed(1)}% ${k}`) }));
  })();
  const trace = value('trace') && (async () => {
    // --trace-early: from the streaming stage on, to see the first frames of the path; otherwise 3 s into it
    while (!(await page.evaluate(early => early ? !!window.cityStage : window.cityStage?.().stage === 'path', flag('trace-early')))) await new Promise(r => setTimeout(r, 300));
    if (!flag('trace-early')) await new Promise(r => setTimeout(r, 3000));
    await browser.startTracing(page, { path: value('trace-out') ?? 'trace.json', categories: ['toplevel', 'gpu', 'gpu.dawn', 'v8', 'devtools.timeline', 'disabled-by-default-v8.gc', 'blink.user_timing'] });
    await new Promise(r => setTimeout(r, Number(value('trace')) * 1000));
    await browser.stopTracing();
  })();
  // --shot: one screenshot 4 s into the path. With speed 0 and no traffic it compares two settings pixel by pixel (the same scene must draw the same picture)
  const shot = value('shot') && (async () => {
    while (!(await page.evaluate(() => window.cityStage?.().stage === 'path'))) await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 4000));
    await page.screenshot({ path: value('shot') });
  })();
  const result = await page.evaluate(([m, p]) => window.sf[m](p), [method, params]);
  await prof; await trace; await shot;
  clearInterval(poll); clearInterval(vramPoll);
  const gpu = await page.evaluate(() => { const { kinds, ...g } = window.__gpu; return g; });
  // per frame: the sum of its passes (busy) and first start to last end (span, which also holds the gaps while the GPU waited for the next pass)
  const gpuTime = await page.evaluate(() => {
    const T = window.__gpuTime; if (!T) return window.__gpuTimeGL ?? null;
    const by = new Map(); for (const [f, a, b] of T.rows) { const o = by.get(f) ?? { busy: 0, a: Infinity, b: 0, n: 0, passes: [] }; o.busy += b - a; o.a = Math.min(o.a, a); o.b = Math.max(o.b, b); o.n++; o.passes.push(b - a); by.set(f, o); }
    const rows = [...by.values()].slice(30), q = (l, p) => { const s = [...l].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] * 100) / 100 : 0; };
    const passes = {}; for (const r of rows) r.passes.forEach((ms, i) => (passes[i] ??= []).push(ms));
    const busy = rows.map(r => r.busy), span = rows.map(r => r.b - r.a);
    return { frames: rows.length, every: T.every, passesPerFrame: q(rows.map(r => r.n), 0.5), busyP50: q(busy, 0.5), busyP95: q(busy, 0.95), busyP99: q(busy, 0.99), busyMax: q(busy, 1), spanP50: q(span, 0.5), spanP95: q(span, 0.95), perPassP50: Object.values(passes).map(l => q(l, 0.5)), perPassP95: Object.values(passes).map(l => q(l, 0.95)) };
  }).catch(() => null);
  console.log(JSON.stringify({ method, backend, params, wallS: Math.round((Date.now() - t0) / 1000), webglRenderer: renderer, gpu, gpuTime, errors: [...new Set(errors)].slice(0, 6), ...(vramRows.length && { vramRows }), result }));
} catch (e) {
  console.log(JSON.stringify({ method, backend, params, failed: String(e?.message ?? e).split('\n')[0] }));
  process.exitCode = 1;
} finally {
  clearInterval(poll); clearInterval(vramPoll);   // a live timer would keep node from exiting after a failed run
  await browser?.close().catch(() => {});
  await server.close();
}
