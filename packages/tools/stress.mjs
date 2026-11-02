// threedog stress [--only a,b] [--frames 30] [--json] [--gpu|--software]: load ramps, one axis at a time, on the neutral page packages/engine/tests/stress/.
// Each axis starts small and grows (×2 per step; post effects one at a time) until the frame crosses 33 ms, fails (shader limit, lost context) or hits
// its cap; a step is 6 warm-up + `frames` measured frames (medians). Prints per step cpu / gpu / frame ms, then a budget table: the largest load that
// still fits 16.7 ms (60 fps) and 33 ms (30 fps), with a log-interpolated crossing estimate. GPU ms needs EXT_disjoint_timer_query_webgl2.
// Renderer: the hardware GPU when headless can reach it (the point of this tool), else SwiftShader with a note. The budget table goes into PERF.md
// labelled with the renderer string it printed.
process.env.THREEDOG_TEST = '1';
import { launchBrowser, buildAndPreview } from './browser.mjs';
import { ENGINE } from './paths.mjs';

const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const ONLY = arg('only')?.split(','), FRAMES = +(arg('frames') ?? 30), JSON_OUT = process.argv.includes('--json');
const say = (...a) => { if (!JSON_OUT) console.log(...a); };
const t0 = Date.now();
const server = await buildAndPreview(ENGINE);
const browser = await launchBrowser({ prefer: 'gpu' });
const out = { renderer: browser.render.renderer ?? 'SwiftShader (software)', kind: browser.render.kind, timer: false, axes: {} };
let code = 0;
try {
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', e => say('  page error', String(e)));
    await page.goto(server.base + '/tests/stress/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.stress?.ready, null, { timeout: 120000 });
    return page;
  };
  const probe = await open();
  const axes = await probe.evaluate(() => window.stress.axes), maxTex = await probe.evaluate(() => window.stress.maxTexture());
  await probe.close();
  for (const k of ONLY ?? []) if (!axes[k]) throw new Error(`stress --only: unknown axis "${k}". Axes: ${Object.keys(axes).join(', ')}`);
  say(`Renderer: ${out.renderer} (${out.kind}) · 1280×720, pixel ratio 1 · ${FRAMES} frames per step, medians`);
  for (const [name, ax] of Object.entries(axes)) {
    if (ONLY && !ONLY.includes(name)) continue;
    say(`\n## ${name}: ${ax.unit}`);
    say('| load | cpu ms | gpu ms | frame ms | draw calls | triangles |\n|---|---|---|---|---|---|');
    // a fresh page per axis: leftover GPU memory and compiled programs of the previous axis would bias the next one
    const page = await open(), steps = [];
    let n = ax.start, stop = 'cap';
    try {
      for (; n <= (name === 'shadowMapSize' ? Math.min(ax.cap, maxTex) : ax.cap); n = await page.evaluate(([a, x]) => window.stress.next(a, x), [name, n])) {
        await page.evaluate(([a, x]) => window.stress.set(a, x), [name, n]);
        // the first step of a fresh page still pays one-time costs (program link, render targets, driver warm-up): measure it twice, keep the second
        if (!steps.length) await page.evaluate(f => window.stress.measure(f), FRAMES);
        const r = await page.evaluate(f => window.stress.measure(f), FRAMES);
        out.timer ||= r.timer;
        if (r.error) { stop = `${r.error} at ${n}`; break; }
        steps.push({ n, ...r });
        say(`| ${n} | ${r.cpu} | ${r.gpu ?? '—'} | ${r.frame} | ${r.drawCalls} | ${r.triangles} |`);
        if (r.frame > 33.3) { stop = '33 ms'; break; }
      }
    } catch (e) { stop = `error at ${n}: ${String(e?.message ?? e).split('\n')[0]}`; }
    await page.close();
    out.axes[name] = { unit: ax.unit, ladder: ax.ladder, steps, stop, fit60: fit(steps, 16.7, ax.ladder), fit30: fit(steps, 33.3, ax.ladder) };
    say(`stopped: ${stop}`);
  }
} catch (e) { console.error(String(e?.message ?? e)); code = 1; }
finally { await browser.close(); await server.close(); }

/** Largest measured load under `ms`, the first above it, and (doubling axes) the log-interpolated crossing */
function fit(steps, ms, ladder) {
  const i = steps.findIndex(s => s.frame > ms), ok = i < 0 ? steps.at(-1) : steps[i - 1], over = i < 0 ? null : steps[i];
  let est = null;
  if (ok && over && !ladder) est = Math.round(ok.n * (over.n / ok.n) ** ((ms - ok.frame) / (over.frame - ok.frame)));
  return { ok: ok ?? null, over, est };
}
const fmt = n => n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : String(n);
const cell = f => !f.ok ? 'none (over at the first step)' : !f.over ? `≥ ${fmt(f.ok.n)} (not crossed)` : f.est ? `≈ ${fmt(f.est)}` : `${fmt(f.ok.n)}`;
const at = f => !f.ok ? '—' : `${f.ok.cpu} / ${f.ok.gpu ?? '—'} / ${f.ok.frame}`;

if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else if (Object.keys(out.axes).length) {
  console.log(`\n## Budget (${out.renderer}${out.timer ? '' : '; no GPU timer: frame time only'})\n`);
  console.log('| axis | fits 16.7 ms | fits 33 ms | cpu / gpu / frame ms at the 16.7 ms load | stopped by |\n|---|---|---|---|---|');
  for (const [k, a] of Object.entries(out.axes)) console.log(`| ${k} (${a.unit}) | ${cell(a.fit60)} | ${cell(a.fit30)} | ${at(a.fit60)} | ${a.stop} |`);
  console.log(`\nframe = cpu + waiting for the GPU (no overlap): a conservative upper bound. Took ${Math.round((Date.now() - t0) / 1000)} s`);
}
process.exit(code);
