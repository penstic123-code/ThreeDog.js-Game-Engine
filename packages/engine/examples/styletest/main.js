// @ts-check
// Style test: one fixed scene to judge a style pack by (and the check an AI runs after turning a reference picture into a style).
// Exhibits (content/): character, trees, rock, grass, flowers, water, terrain, glass, a shadow receiver, wood / stone / metal, a lit room (outside and inside),
// and the UI parts (HUD, dialogue, bag) on the `ui` view. Parameters (params.js): time, weather, style, env, view, panel. Camera views: views.js.
// main.js holds wiring only: modules, finding the stage, view switching, the lamp. The exhibits are content (rule R33).
import { params } from './params.js';   // first: rewrites ?time=dusk style words before the engine reads the URL
import { createEngine, openWorld, presets, content, interactions, dialogue, inventory, fixedCamera, hud, lightPool, createTerrain } from '../../index.js';
import lowpoly, { assets as lowpolyAssets } from '@threedog/style-lowpoly';   // optional package: the style under test, and the procedural trees / rocks
import { terrainPreset, riverAt, terrainStrings } from '@threedog/terrain-noise';
import look from './look.js';
import data from './content/index.js';
import { woodBlock, stoneBlock, metalBall, glassPanes, shadowStage, room } from './models.js';
import { makeViews, pathAt } from './views.js';

// ---------- 0. The stage: a flat spot with water close by (same seed = same place every run) ----------
const SEED = 1337, preview = createTerrain({ seed: SEED, ...terrainPreset() });
/** Nearest point under water within maxR of (x, z), or null */
function waterNear(x, z, maxR) {
  for (let r = 8; r <= maxR; r += 3) for (let a = 0; a < 6.28; a += 0.3) {
    const wx = x + Math.cos(a) * r, wz = z + Math.sin(a) * r;
    if (preview.surface(wx, wz) < preview.waterLevel - 1.2) return { x: wx, z: wz };
  }
  return null;
}
let stage = { x: 0, z: 0 }, water = { x: 30, z: 0 };
for (let r = 0, found = false; r < 3000 && !found; r += 10) {
  const a = r * 0.37, x = Math.cos(a) * r, z = Math.sin(a) * r, h = preview.surface(x, z);
  if (h > 4 && h < 10 && preview.slope(x, z) < 0.2 && riverAt(x, z, preview.noise) === 0) {
    const w = waterNear(x, z, 60);
    if (w) { stage = { x, z }; water = w; found = true; }
  }
}

// ---------- 1. Engine: style under test + open-world preset with a fixed sky (no clock drift between screenshots) ----------
const parts = params.style === 'none' ? [] : [lowpoly, look];
if (params.overrides) parts.push(params.overrides);   // the workbench's "rebuild preview" values
const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style: parts.length ? parts : undefined, strings: terrainStrings, saveKey: 'threedog-styletest',
  ui: { loading: { title: 'style test' } } });
engine.use(openWorld({ camera: fixedCamera(), seed: SEED, terrain: terrainPreset(), flatten: [{ x: stage.x, z: stage.z, radius: 30 }], sky: { ...presets.calendar.fixedTime, time: 0.5 },
  weather: presets.weather.temperate, autoWeather: false }),
  interactions({ ...presets.interactions.nearest }), dialogue({ holdSeconds: 1e6 }), inventory({ ...presets.keys.inventory }), hud(), lightPool({ point: 2 }), content());

engine.assets.manifest(lowpolyAssets);
engine.assets.manifest({ name: 'styletest', models: { woodBlock, stoneBlock, metalBall, glassPanes, shadowStage, room } });   // the names content/templates.js uses
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: { x: stage.x + 0.5, z: stage.z + 6 } });
engine.content.load(data, { places: { stage, water } });
if (params.env) { engine.sky.setEnvironment({ source: 'sky', intensity: 0.8 }); engine.sky.modify('env', { ambient: 0.6 }); }   // soft ambient from the sky: lower the hemisphere ambient so shadows stay

// ---------- 2. The room's lamp: emissive plus one pooled light, on from 18:00 to 06:00 ----------
const lampPos = [stage.x + 14, engine.surface(stage.x + 14, stage.z - 2) + 2.7, stage.z - 2];
const lampLight = engine.lightPool.add({ x: lampPos[0], y: lampPos[1], z: lampPos[2] }, { color: 0xffc070, intensity: 0, distance: 9 });
let lampOn = false;
engine.sky.between('18:00', '06:00', { on: () => { lampOn = true; }, off: () => { lampOn = false; } });
engine.onFrame(() => {
  const lamp = /** @type {import('three').Mesh<any, import('three').MeshLambertMaterial> | undefined} */ (engine.world.view('room')?.getObjectByName('lamp'));
  if (lamp) lamp.material.emissiveIntensity = lampOn ? 1.6 : 0;
  lampLight.set({ intensity: lampOn ? 5 : 0 });
});

// ---------- 3. Views: an op, so the URL, the dev bridge and tests switch the same way ----------
/** @type {{ view: string, since: number, views: ReturnType<typeof makeViews> }} */
const state = { view: params.view, since: 0, views: /** @type {any} */ (null) };
/** Show the UI exhibits only on the ui view; close them when leaving it */
function showUi(on) {
  if (on) {
    engine.dialogue.say('The light is best just before dusk. Mind the step.', { speaker: 'Guide', lock: false });
    engine.ui.open('inventory');
  } else { engine.dialogue.end(); engine.ui.close('inventory'); }
}
/** Fixed camera (views.js shots): a view is a shot, cut to at once. The path shot is moved along its line every frame, from the moment it is chosen */
function setView(name) {
  const cam = /** @type {any} */ (engine.cameraRig), views = makeViews(engine, stage, water);
  for (const [n, v] of Object.entries(views)) cam.add(n, { position: v.pos, lookAt: v.look });
  state.view = name; state.since = engine.elapsed; state.views = views;
  showUi(name === 'ui');
  cam.cut(name);
}
engine.onFrame(() => {
  if (state.view === 'path' && state.views) /** @type {any} */ (engine.cameraRig).shots.path.position.fromArray(pathAt(state.views.path, engine.elapsed - state.since));
});
engine.ops.define('styletest.view', {
  desc: 'Move the camera to a named view: overview, character, water, room, path, ui', args: { name: 'string' },
  can: (e, { name }) => ['overview', 'character', 'water', 'room', 'path', 'ui'].includes(name) ? true : 'unknownView',
  run: (e, { name }) => { setView(name); return name; },
  reasons: { unknownView: 'View names: overview, character, water, room, path, ui' },
});
engine.describe.add('styletest', () => ({ view: state.view, style: params.style, env: params.env, panel: params.panel, stage: { x: +stage.x.toFixed(1), z: +stage.z.toFixed(1) } }));
engine.events.on('engine:ready', () => engine.ops.run('styletest.view', { name: params.view }));
if (params.badView) console.warn(`styletest: unknown view '${params.badView}', showing overview. Views: overview, character, water, room, path, ui`);

// The workbench is a dev tool loaded only on ?panel=1 (its package may be missing: panel.js then says so in the page)
if (params.panel) import('./panel.js').then(m => m.openPanel(engine, params.overrides));

engine.start();
window.engine = engine;   // handy for debugging in the browser console
