// The dev panel (packages/tools/panel, ?panel=1). Guard: a value changed in the panel is the three.js object's value, and it is still there after
// frames (nothing in the engine writes it back); the panel's source reads no look layer; without tweakpane the page says so and runs on.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const READY = { timeout: 60000 };
const opened = page => page.waitForFunction(() => window.engine?.devPanel, null, READY);

export const specs = [
  {
    name: '[守] 开发面板：改水和雾的值写到 three.js 对象上，过几帧还在；没装的模块不出现',
    url: '/tests/panel/index.html?panel=1',
    async run({ page, check, ev, frames }) {
      await opened(page);
      // tweakpane rows by folder and label; setRawValue fires the same 'change' event a drag does
      const set = (folder, label, value) => ev(([fo, l, v]) => {
        const all = n => (n.children ?? []).flatMap(c => [c, ...all(c)]);
        const b = all(all(engine.devPanel.pane).find(c => c.title === fo)).find(c => c.label === l);
        if (!b) return false;
        const text = typeof v === 'string' && b.element.querySelector('input[type=text]');   // a color is typed into its text field, like a person would
        if (text) { text.value = v; text.dispatchEvent(new Event('change', { bubbles: true })); } else b.controller.value.setRawValue(v);
        return true;
      }, [folder, label, value]);

      check('found: fog far, fog color, water color, water uWave, the light, exposure', (await Promise.all([
        set('雾 scene.fog', 'far', 123), set('雾 scene.fog', 'color', '#112233'), set('material', 'color', '#335577'), set('uniforms', 'uWave', 0.37),
        set('key', 'intensity', 3.5), set('renderer', '曝光 exposure', 1.7)])).every(Boolean));
      await frames(5);
      const r = await ev(() => ({ far: engine.scene.fog.far, fog: engine.scene.fog.color.getHexString(), water: engine.water.material.color.getHexString(),
        wave: engine.water.uniforms.uWave.value, key: engine.scene.getObjectByName('key').intensity, exp: engine.renderer.toneMappingExposure,
        tune: engine.describe().devPanel.tune, titles: (function all(n) { return (n.children ?? []).flatMap(c => [c.title, ...all(c)]); })(engine.devPanel.pane) }));
      check('fog far and color are on scene.fog after 5 frames', r.far === 123 && r.fog === '112233', JSON.stringify(r));
      check('water color on the material, uWave on the uniform, after 5 frames', r.water === '335577' && Math.abs(r.wave - 0.37) < 1e-6, JSON.stringify(r));
      check('light intensity and exposure stay', r.key === 3.5 && r.exp === 1.7, JSON.stringify(r));
      check('write back holds them as three.js code paths', r.tune.values['engine.scene.fog.far'] === 123 && r.tune.values['engine.water.material.color'] === '#335577'
        && r.tune.values['engine.water.uniforms.uWave.value'] === r.wave && r.tune.values['engine.scene.getObjectByName("key").intensity'] === 3.5, JSON.stringify(r.tune));
      check('terrain and vegetation are not installed: no folder, no error', !r.titles.includes('地形 terrain') && !r.titles.includes('植被 vegetation'), r.titles.join(' | '));

      // [guard] the post folder goes through the handle's public enabled and set()
      await set('dim', 'amount', 0.4);
      await set('dim', '开 on', false);
      const dim = await ev(() => { const h = engine.post.get('dim'); return { amount: h.params.amount, on: h.enabled }; });
      check('[guard] post folder: a param and the on / off reach the effect', Math.abs(dim.amount - 0.4) < 1e-6 && dim.on === false, JSON.stringify(dim));

      // the material swapped after the panel opened is the one written
      await ev(() => { window.was = engine.water.material; engine.water.material = window.was.clone(); });
      await set('material', 'color', '#775533');
      const swapped = await ev(() => ({ now: engine.water.material.color.getHexString(), was: window.was.color.getHexString() }));
      check('a swapped water material gets the write, the old one does not', swapped.now === '775533' && swapped.was === '335577', JSON.stringify(swapped));
    },
  },
  {
    name: '[守] 开发面板的源码不读外观层',
    url: '/tests/panel/index.html',
    async run({ check }) {
      const src = readFileSync(fileURLToPath(new URL('../../../tools/panel/index.js', import.meta.url)), 'utf8');
      const hits = src.match(/\b(engine|e)\.(look|style)\b|describe\(\)\.look|\.look\.|styleWorkbench/g);
      check('no engine.look, engine.style or describe().look', !hits, String(hits));
    },
  },
  {
    name: '开发面板：tweakpane 缺失或加载失败时页面给出提示，不白屏',
    url: '/tests/panel/index.html',
    async run({ page, check, ev }) {
      await page.route(/tweakpane/, route => route.abort());
      await page.goto(new URL('/tests/panel/index.html?panel=1', page.url()).href);
      await page.waitForFunction(() => window.engine?.stateApplied && document.getElementById('panel-note'), null, READY);
      const r = await ev(() => ({ note: document.getElementById('panel-note').textContent, panel: !!engine.devPanel, frame: engine.renderer.info.render.frame }));
      check('the page names tweakpane and npm install, there is no panel', /tweakpane/.test(r.note) && /npm install/.test(r.note) && !r.panel, JSON.stringify(r));
    },
    expectErrors: /tweakpane|Failed to load resource|net::ERR_FAILED/i,
  },
];
