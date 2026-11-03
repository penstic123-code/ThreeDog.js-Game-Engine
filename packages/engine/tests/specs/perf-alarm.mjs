// Loose slowdown alarm: the fixed reference scene of tests/stress (a bit of every load axis) must not get more than 30% costlier per frame than the
// committed baseline tests/perf-baseline.json for the same renderer. Not a benchmark: it catches "something made every frame much slower".
// Why it does not flake on SwiftShader with other browsers running on the machine: warm-up first, 7 samples, the median; each sample is divided by a
// fixed JS workload timed right next to it in the same page, so a slower or busier CPU scales both and cancels out. A different renderer string
// (another GPU) has no baseline: the check passes with a note. Rewrite the baseline after an intended change: npm test -- slowdown --update-snapshots
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE } from '@threedog/tools/paths';
import { SOFTWARE_RENDERER } from '@threedog/tools/browser';

const FILE = join(ENGINE, 'tests', 'perf-baseline.json'), LIMIT = 1.3;

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
      const mid = a => [...a].sort((x, y) => x - y)[a.length >> 1];
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
        `the reference scene got ${Math.round((now.ratio / base.ratio - 1) * 100)}% costlier. Find which axis: threedog stress (compare with PERF.md "Load budget"); ` +
        'if the slowdown is intended, rewrite the baseline: npm test -- slowdown --update-snapshots');
    },
  },
];
