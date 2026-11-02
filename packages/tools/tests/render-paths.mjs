// The two headless render paths of browser.mjs: tests on SwiftShader (same pixels everywhere), shot / gallery / perf / stress on the hardware GPU
// with a verified fallback. Why a test: a GPU launch that silently lands on software makes every perf number and "GPU ms" a lie, and a test
// browser that drifts onto the GPU makes pixel comparisons machine-dependent; both look fine until someone reads a wrong number.
import { launchBrowser, probeRenderer, SOFTWARE_RENDERER, forcedRender } from '../browser.mjs';

export const name = 'render paths: tests stay on software rendering, a GPU launch is verified or falls back with a reason, THREEDOG_RENDER forces one';

export async function run({ check, browser }) {
  const forced = forcedRender();
  const own = await probeRenderer(browser);
  if (forced !== 'gpu') check(`the test runner's browser renders with software (${own?.renderer})`, browser.render.kind === 'software' && SOFTWARE_RENDERER.test(own?.renderer ?? ''), JSON.stringify(browser.render));
  const saved = process.env.THREEDOG_RENDER;
  try {
    delete process.env.THREEDOG_RENDER;
    const g = await launchBrowser({ prefer: 'gpu' });
    try {
      const r = await probeRenderer(g);
      check(`prefer gpu: a hardware renderer, or software with the fallback reason (${g.render.kind}: ${r?.renderer})`,
        g.render.kind === 'gpu' ? !SOFTWARE_RENDERER.test(r.renderer) && g.render.renderer === r.renderer : SOFTWARE_RENDERER.test(r?.renderer ?? '') && !!g.render.fallback,
        JSON.stringify(g.render));
    } finally { await g.close(); }
    process.env.THREEDOG_RENDER = 'software';
    const s = await launchBrowser({ prefer: 'gpu' });
    try { check('THREEDOG_RENDER=software overrides prefer: gpu', s.render.kind === 'software' && SOFTWARE_RENDERER.test((await probeRenderer(s))?.renderer ?? '')); }
    finally { await s.close(); }
    process.env.THREEDOG_RENDER = 'fast';
    check('an unknown THREEDOG_RENDER value is refused, naming the choices', await launchBrowser().then(b => { b.close(); return ''; }, e => e.message).then(m => /gpu or software/.test(m)));
  } finally { if (saved === undefined) delete process.env.THREEDOG_RENDER; else process.env.THREEDOG_RENDER = saved; }
}
