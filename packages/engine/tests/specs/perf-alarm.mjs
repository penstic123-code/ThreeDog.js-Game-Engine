// Loose slowdown alarm: the fixed reference scene of tests/stress (a bit of every load axis) must not get more than 30% costlier per frame than the
// committed baseline tests/perf-baseline.json for the same renderer. Not a benchmark: it catches "something made every frame much slower".
// Why it does not flake on SwiftShader with other browsers running on the machine: warm-up first, 7 samples, the median; each sample is divided by a
// fixed JS workload timed right next to it in the same page, so a slower or busier CPU scales both and cancels out. A different renderer string
// (another GPU) has no baseline: the check passes with a note. Rewrite the baseline after an intended change: npm test -- slowdown --update-snapshots
// The first-frame alarm beside it is the same idea for start-up: page open to the first frame drawn after the loading screen
// (engine.startup.firstFrameMs) on the open-world example, opened in 5 new tabs, each divided by the same JS calibration, the fastest; baseline key firstFrame.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from '@threedog/tools/paths';
import { SOFTWARE_RENDERER } from '@threedog/tools/browser';

const FILE = join(ENGINE, 'tests', 'perf-baseline.json'), LIMIT = 1.3;
// Start-up mixes downloads, the GPU process and shader compiles, which a JS calibration cancels less well than frame cost: a looser limit.
// It still catches "compiles every shader up front" or "loads a whole level before the first view" (2x or more)
const FIRST_LIMIT = 1.5, RELOADS = 5;
const mid = a => [...a].sort((x, y) => x - y)[a.length >> 1];

export const specs = [
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    software: true,   // the committed baseline is per renderer kind and is recorded on software
    name: 'PERF slowdown alarm: the stress reference scene costs at most 30% more per frame than the committed baseline (same renderer)',
    url: '/tests/stress/index.html?axis=reference',
    timeout: 240000,
    async run({ check, ev }) {
      const r = await ev(async () => {
        await __t.until(() => window.stress?.ready, 60000);
        const gl = engine.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
        await window.stress.measure(10, 10);   // warm-up: programs, shadow map, render targets
        const samples = [];
        for (let i = 0; i < 7; i++) {
          const c = window.stress.calibrate().ms, m = await window.stress.measure(8, 2);
          samples.push({ frame: m.frame, calib: c, ratio: m.frame / c, error: m.error });
        }
        return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', samples };
      });
      const kind = SOFTWARE_RENDERER.test(r.renderer) ? 'software' : 'gpu';
      const now = { renderer: r.renderer, ratio: +mid(r.samples.map(s => s.ratio)).toFixed(3), frameMs: mid(r.samples.map(s => s.frame)), calibMs: mid(r.samples.map(s => s.calib)) };
      check('reference scene renders without a shader / context error', r.samples.every(s => !s.error), JSON.stringify(r.samples[0]));
      const all = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
      if (process.env.THREEDOG_UPDATE_SNAPSHOTS) {
        all[kind] = { ...now, date: new Date().toISOString().slice(0, 10) };
        writeFileSync(FILE, JSON.stringify(all, null, 1) + '\n');
        check(`baseline written for ${kind}: ${JSON.stringify(all[kind])}`, true);
        return;
      }
      const base = all[kind];
      if (!base || base.renderer !== r.renderer) {
        check(`skipped: no baseline for this renderer (${r.renderer}); baseline has ${base?.renderer ?? 'none'}. Record one with --update-snapshots`, true);
        return;
      }
      check(`frame cost / JS calibration ${now.ratio} vs baseline ${base.ratio} (limit ×${LIMIT}; frame ${now.frameMs} ms, calibration ${now.calibMs} ms)`,
        now.ratio <= base.ratio * LIMIT,
        `the reference scene got ${Math.round((now.ratio / base.ratio - 1) * 100)}% costlier. Find which axis: threedog stress (compare with docs/testing/perf.md "Load budget"); ` +
        'if the slowdown is intended, rewrite the baseline: npm test -- slowdown --update-snapshots');
    },
  },
  {
    serial: true,   // timing assertion: runs alone, not beside other pages
    software: true,
    name: 'PERF first frame slowdown alarm: the open world reaches its first drawn frame at most 50% later than the committed baseline (same renderer)',
    url: '/',
    timeout: 300000,
    async run({ check, page }) {
      const runs = [];
      // the runner's load warms the shader cache; each run is a new tab, not a reload: a reload's clock starts before the old page
      // unloaded, and tearing down the open world (GPU context, workers) was 2.5 s of "script" on software
      const wait = p => p.waitForFunction(() => window.engine?.startup?.firstFrameMs != null, null, { timeout: 120000 });
      await wait(page);
      const url = page.url();
      await page.goto('about:blank');   // a running open world beside the measured tab made its first frame 7x later on software
      // the JS calibration runs on that blank page right before each tab: timed inside the game page it shared the CPU with the game's own loop
      const calibrate = () => page.evaluate(() => { const t0 = performance.now(); let x = 0; for (let j = 0; j < 4e6; j++) x += Math.sqrt(j) * 1.0000001; return performance.now() - t0 + (x < 0 ? 1 : 0); });
      const calibs = [];
      for (let i = 0; i < RELOADS; i++) {
        calibs.push(await calibrate());
        const tab = await page.context().browser().newPage({ viewport: page.viewportSize() });   // own context: cold HTTP cache, like a first visit
        await tab.goto(url, { waitUntil: 'domcontentloaded' });
        await wait(tab);
        runs.push(await tab.evaluate(() => {
          const gl = engine.renderer.getContext?.(), dbg = gl?.getExtension('WEBGL_debug_renderer_info');
          return { first: engine.startup.firstFrameMs, phases: engine.startup.phases, renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown' };
        }));
        await tab.close();
      }
      const r = runs[0].renderer, kind = SOFTWARE_RENDERER.test(r) ? 'software' : 'gpu';
      // the fastest run, not the median: machine load only ever adds time, and the median of 5 still moved 35% between two quiet runs
      const pick = runs.slice().sort((x, y) => x.first - y.first)[0], calib = mid(calibs);
      const now = { renderer: r, ratio: +(pick.first / calib).toFixed(2), firstFrameMs: pick.first, calibMs: +calib.toFixed(1), phases: pick.phases };
      const sum = Object.values(pick.phases).reduce((a, b) => a + b, 0);
      check(`phases add up to firstFrameMs (${sum} vs ${pick.first}): ${JSON.stringify(pick.phases)}`, sum === pick.first);
      const all = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
      if (process.env.THREEDOG_UPDATE_SNAPSHOTS) {
        all.firstFrame = { ...all.firstFrame, [kind]: { ...now, date: new Date().toISOString().slice(0, 10) } };
        writeFileSync(FILE, JSON.stringify(all, null, 1) + '\n');
        check(`first-frame baseline written for ${kind}: ${JSON.stringify(now)}`, true);
        return;
      }
      const base = all.firstFrame?.[kind];
      if (!base || base.renderer !== r) {
        check(`skipped: no first-frame baseline for this renderer (${r}); baseline has ${base?.renderer ?? 'none'}. Record one with --update-snapshots`, true);
        return;
      }
      check(`first frame / JS calibration ${now.ratio} vs baseline ${base.ratio} (limit x${FIRST_LIMIT}; first frame ${now.firstFrameMs} ms vs ${base.firstFrameMs} ms, ` +
        `calibration ${now.calibMs} ms; runs ${runs.map(x => x.first).join(' / ')} ms)`,
        now.ratio <= base.ratio * FIRST_LIMIT,
        `the first frame got ${Math.round((now.ratio / base.ratio - 1) * 100)}% later. Compare the phases with the baseline's ` +
        `(${Object.entries(base.phases).map(([k, v]) => `${k} ${v} -> ${now.phases[k]}`).join(', ')}); npx threedog perf --only=startup ` +
        'measures every example. If intended, rewrite the baseline: npm test -- "first frame" --update-snapshots');
    },
  },
];
