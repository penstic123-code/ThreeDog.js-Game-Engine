// Runner page for recipe 66's sections (tests/specs/recipe-66.mjs sends each game block here as text, imports already turned into __mod calls).
// Each block runs on a fresh #view canvas and builds its own engine, as a game's main.js does; the section's check block then runs through the bridge's own script path.
import * as THREE from 'three';
import * as TD from '../../index.js';

const base = { ui: { loading: false }, urlState: false, pixelRatio: 1, adaptiveResolution: false };
let n = 0, made = null;
// createEngine as the blocks see it: same function, but the runner keeps the engine and gives each block its own save space
const createEngine = (o = {}) => (made = TD.createEngine({ ...base, saveKey: `test-recipe-66-${++n}`, ...o }));
const MODS = { three: THREE, threedog: { ...TD, createEngine } };
const mod = name => { if (!(name in MODS)) throw new Error(`recipe 66 block imports '${name}', which the runner does not provide (add it to MODS)`); return MODS[name]; };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

const host = window.engine = TD.createEngine({ canvas: document.getElementById('host'), ...base, saveKey: 'test-recipe-66' });
await host.start();
host.haltLoop();

/** Run one game block; window.engine is then that block's engine. Returns { ok, error } */
window.runGame = async code => {
  made?.dispose();
  document.getElementById('view')?.remove();
  document.body.appendChild(Object.assign(document.createElement('canvas'), { id: 'view', width: 160, height: 120 }));
  try {
    await new AsyncFunction('__mod', `{\n${code}\n}`)(mod);
    if (!made?.ready) throw new Error('the block did not start an engine');
    if (window.engine !== made) throw new Error('the block did not put its engine on window: threedog js could not reach it');
    made.haltLoop();
    return { ok: true };
  } catch (err) { return { ok: false, error: String(err?.stack ?? err) }; }
};
