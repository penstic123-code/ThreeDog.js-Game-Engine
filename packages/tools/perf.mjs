// Performance comparison: npm run perf (run this before writing results into packages/engine/docs/PERF.md)
// Build (including test pages) → open the packages/engine/tests/perf/ pages in a headless browser and measure:
//   1. native three.js vs the engine (no modules) on the same scene: 2000 cubes + 1 directional light with shadows, CPU milliseconds per frame and draw calls
//   2. per-module time per frame with openWorld fully on
//   3. shadow updateEvery 1 vs 3, snap 0.5 vs 'texel': shadow update count, shadow draw calls, milliseconds per frame
//   4. time for the two examples to go from open to playable (engine.startup) and the first-screen chunk time
//   5. automatic batching (engine.batching): 3000 repeated props over 4 models, batching off vs on
// Run one section only: npm run perf -- --only=props (sections: native, world, startup, props)
// With software rendering (swiftshader) GPU work counts as CPU time, so only look at relative differences. Frame count: npm run perf -- 120
process.env.THREEDOG_TEST = '1';
import { launchBrowser, buildAndPreview } from './browser.mjs';
import { ENGINE } from './paths.mjs';

// It measures the engine package (test pages in tests/perf/ and the two examples), regardless of the directory it is run from
const ONLY = process.argv.find(a => a.startsWith('--only='))?.slice(7), want = k => !ONLY || ONLY === k;
const FRAMES = +(process.argv.slice(2).find(a => /^\d+$/.test(a)) || 60);
const server = await buildAndPreview(ENGINE), base = server.base;
// A fresh browser for every page (leftover work in the software-rendering GPU process from the previous page would slow the next one)
async function open(url) {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.close = () => browser.close();
  page.on('pageerror', e => console.log('  page error', String(e)));
  await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.engine?.ready, null, { timeout: 120000 });
  return page;
}
// Run each item 3 times and take the median (the first run often includes one-time costs such as shader compilation)
async function median(page, fn, arg) {
  const rs = [];
  for (let i = 0; i < 3; i++) rs.push(await page.evaluate(fn, arg));
  rs.sort((a, b) => a.cpuMs - b.cpuMs);
  return rs[1];
}
const row = (...c) => console.log('| ' + c.join(' | ') + ' |');

if (want('native')) {
console.log(`\n## 1. native three.js vs the engine (${FRAMES} frames, 2000 cubes + directional light shadow)\n`);
row('', 'CPU ms/frame', 'render ms/frame', 'draw calls', 'triangles', 'shadow draw calls');
row('---', '---', '---', '---', '---', '---');
for (const mode of ['native', 'engine', 'native', 'engine']) {   // two alternating rounds, to see whether order matters
  const page = await open(`/tests/perf/index.html?mode=${mode}`);
  const r = await median(page, n => window.bench.run(n), FRAMES);
  row(mode === 'native' ? 'native three.js' : 'engine (no modules)', r.cpuMs, r.renderMs, r.drawCalls, r.triangles, r.shadowCalls);
  await page.close();
}

}
if (want('world')) {
console.log(`\n## 2. openWorld fully on, per-module time per frame (${FRAMES} frames, player moving forward at 6 m/s)\n`);
const world = await open('/tests/perf/index.html?mode=world');
const w = await median(world, n => window.bench.run(n, { move: 6 }), FRAMES);
console.log(`whole frame ${w.cpuMs} ms, of which render ${w.renderMs} ms; draw calls ${w.drawCalls}, triangles ${w.triangles}\n`);
row('module', 'ms/frame');
row('---', '---');
for (const [k, v] of Object.entries(w.modules).sort((a, b) => b[1] - a[1])) row(k, v);

console.log(`\n## 3. shadow parameter comparison (openWorld, ${FRAMES} frames, player moving forward at 6 m/s)\n`);
row('updateEvery', 'snap', 'shadow updates', 'shadow draw calls per update', 'CPU ms/frame', 'render ms/frame');
row('---', '---', '---', '---', '---', '---');
for (const [updateEvery, snap] of [[1, 0.5], [3, 0.5], [1, 'texel'], [3, 'texel']]) {
  const r = await median(world, ([n, o]) => { engine.sky.setShadow(o); return window.bench.run(n, { move: 6 }); }, [FRAMES, { updateEvery, snap }]);
  row(updateEvery, snap, `${r.shadowRenders}/${FRAMES}`, r.shadowCalls, r.cpuMs, r.renderMs);
}
await world.close();

}
if (want('startup')) {
console.log('\n## 4. open to playable (engine.startup)\n');
row('example', 'open to playable ms', 'start() to playable ms', 'asset preload ms', 'first-screen chunks (terrain ready) ms', 'slowest module');
row('---', '---', '---', '---', '---', '---');
for (const [name, url] of [['open world', '/'], ['town', '/tests/city/index.html']]) {
  const page = await open(url);
  const s = await page.evaluate(() => engine.startup);
  const slow = Object.entries(s.modules).map(([k, v]) => [k, (v.init ?? 0) + (v.ready ?? 0)]).sort((a, b) => b[1] - a[1])[0];
  row(name, s.totalMs, s.startMs, s.preloadMs, s.modules.terrain?.ready ?? '—', slow ? `${slow[0]} ${slow[1]}` : '—');
  await page.close();
}

}
if (want('props')) {
  console.log(`\n## 5. automatic batching (${FRAMES} frames, 3000 repeated props over 4 models placed through world.present, directional shadow)\n`);
  row('', 'CPU ms/frame', 'render ms/frame', 'draw calls (incl. shadow)', 'shadow draw calls', 'batches', 'instances');
  row('---', '---', '---', '---', '---', '---', '---');
  for (const batch of ['0', '1', '0', '1']) {
    const page = await open(`/tests/perf/index.html?mode=props&n=3000&batch=${batch}`);
    const r = await median(page, n => window.bench.run(n), FRAMES);
    const st = await page.evaluate(() => engine.batching.stats);
    row(batch === '0' ? 'batching off' : 'batching on', r.cpuMs, r.renderMs, r.drawCalls, r.shadowCalls, st.batches, st.instances);
    await page.close();
  }
}

await server.close();
