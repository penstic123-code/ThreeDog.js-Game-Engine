// Runner page for recipe 56's code blocks (tests/specs/recipe-56.mjs sends each ```js block here as text, imports already turned into __mod calls).
// Each block runs in a fresh scope with `engine` = a new engine on the WebGPU route (sky installed, not started yet), the way the recipe's
// snippets assume; a block that builds its own engine gets a fresh #view canvas. Then every engine involved starts and draws three frames,
// and anything logged as an error, any engine error or a throw fails that block.
// Why navigator.gpu is taken away: headless browsers differ in whether they offer WebGPU; without it every run takes the default fallback
// ('webgl2': the same WebGPURenderer on WebGL2), which is the backend the WebGPU tests use everywhere.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as TDT from 'threedog/tsl';
import * as PE from '@threedog/post-effects';
import * as TD from '../../index.js';

Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });

const base = { ui: { loading: false }, urlState: false, pixelRatio: 1, adaptiveResolution: false };
let n = 0, made = [];
// createEngine as the blocks see it: same function, but the runner keeps each engine to start, step and dispose it
const createEngine = (o = {}) => { const e = TD.createEngine({ ...base, saveKey: `test-recipe-56-${++n}`, ...o }); made.push(e); return e; };
const MODS = { three: THREE, 'three/webgpu': TG, 'three/tsl': TSL, 'threedog/tsl': TDT, '@threedog/post-effects': PE, threedog: { ...TD, createEngine } };
const mod = name => { if (!(name in MODS)) throw new Error(`recipe 56 block imports '${name}', which the runner does not provide (add it to MODS)`); return MODS[name]; };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const host = window.engine = TD.createEngine({ canvas: document.getElementById('host'), ...base, saveKey: 'test-recipe-56', renderer: 'webgpu' });
await host.start();
host.haltLoop();

/** Run one block (its import lines already rewritten); returns { ok, error, logged, backends } */
window.runBlock = async code => {
  document.getElementById('view')?.remove();
  const view = Object.assign(document.createElement('canvas'), { id: 'view', width: 160, height: 120 });
  document.body.appendChild(view);
  made = [];
  const engine = createEngine({ canvas: Object.assign(document.createElement('canvas'), { width: 160, height: 120 }), renderer: 'webgpu' });
  engine.use(TD.sky());
  const logged = [], error = console.error, warn = console.warn;
  console.error = (...a) => { logged.push(a.map(String).join(' ')); error(...a); };
  try {
    // a block of its own: `const engine = createEngine(...)` inside it shadows the runner's engine instead of clashing with the parameter
    await new AsyncFunction('__mod', 'engine', `{\n${code}\n}`)(mod, engine);
    const backends = [];
    for (const e of made) {
      if (!e.ready) await e.start();
      e.haltLoop();
      for (let i = 0; i < 3; i++) e.step(1 / 60);
      if (e.error) throw e.error;
      backends.push(e.describe().renderer.backend);
    }
    return { ok: logged.length === 0, error: logged[0] ?? '', logged: logged.length, backends };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).split('\n')[0], logged: logged.length };
  } finally {
    console.error = error; console.warn = warn;
    for (const e of made) { try { e.dispose(); } catch { /* already gone */ } }
  }
};
