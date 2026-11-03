// @ts-check
// Sheep island: a small floating island built only from the engine's public entry points (the acceptance scene of docs/plans/done/acceptance-sheepisland.md).
// A meadow with a river, round trees, a wheat field and a flock of sheep on an island with a ragged rim, over a pale backdrop with no horizon.
// Parameters (params.js): time day | dusk | night, weather clear | snow, view overview | flock | field | river | rim.
// main.js holds wiring only: modules, the island's terrain functions, view switching and the snow-to-winter link. Objects are content (rule R33),
// the look is the style in style/.
import { params, VIEW_NAMES } from './params.js';   // first: rewrites ?time=dusk style words before the engine reads the URL
import { createEngine, openWorld, presets, content, fixedCamera } from '../../index.js';
import style from './style/index.js';
import packs from './assets.js';
import data from './content/index.js';
import { VIEWS } from './views.js';

// ---------- 1. The island: outline, height and ground types are world rules, so they live here, not in the style ----------
// Every function runs in terrain workers: pure, only its parameters and Math (recipe 28 §1).
const island = {
  resolution: 48,   // 64 m chunk / 48 = 1.33 m cells: the rim is cut along cells, so finer cells give a finer brushed edge (recipe 42 §4)
  // the river's centre line z = amp * sin(x * freq) + shift: one set of numbers both functions read (n.params), so the dip and the river
  // ground type cannot drift apart
  params: { river: { amp: 6, freq: 0.09, shift: 2, dip: 3.2, wet: 2.4 } },
  height: (x, z, n) => {
    const r = n.params.river, d = Math.abs(z - (r.amp * Math.sin(x * r.freq) + r.shift));   // distance to the river's centre line
    return 3 + 1.2 * n.fbm(x * 0.03, z * 0.03) - (d < r.dip ? (1 - d / r.dip) * 0.6 : 0);   // a gentle meadow, a shallow dip for the river
  },
  groundType: (x, z, h, slope, n) => {
    const r = n.params.river;
    if (Math.abs(z - (r.amp * Math.sin(x * r.freq) + r.shift)) < r.wet) return 'river';
    const fx = (x - 14) / 9.5, fz = (z + 13) / 6.5;                              // the wheat field: an ellipse north-east of the river
    return fx * fx + fz * fz < 1 ? 'wheat' : 'grass';
  },
  shape: {
    mask: (x, z) => 30 - Math.hypot(x, z * 1.15),                             // > 0 is ground: a 60 x 52 m oval
    // a ragged outline and a chipped rim. round stays 0: with round > 0 the bent-down top leaves see-through gaps above the wall (acceptance notes)
    edge: { noise: 3, size: 9, jitter: 0.5, round: 0 },
    // own wall material: it takes no season tint, so in snow the earth walls stay brown under a white top
    side: { depth: 2.5, material: engine => engine.makeMaterial('cliff', { vertexColors: true }) },
    bottom: { depth: (x, z, n, m) => 1.5 + m * 0.35 + 2 * n.fbm(x * 0.08, z * 0.08), ground: 'rock' },   // hangs lower inland
  },
};

// ---------- 2. Engine: own style, open-world preset with a fixed sky; a two-season calendar so snow can turn the island white ----------
const WINTER_DAY = 1001;   // seasons last 1000 days each, so the season never blends towards the next one (it does over the last 20%)
const engine = createEngine({ bindings: { ...presets.bindings.debug }, canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), style, saveKey: 'threedog-sheepisland',
  ui: { loading: { title: 'sheep island' } } });
engine.use(openWorld({ camera: fixedCamera(), terrain: island, water: false, rigid: false, ambience: false,
  calendar: { ...presets.calendar.fixedTime, time: 0.5, seasons: ['summer', 'winter'], daysPerSeason: 1000 },
  weather: { ...presets.weather.temperate, start: 'clear' }, autoWeather: false }), content());
engine.assets.manifest(packs);
engine.content.load(data);

// ---------- 3. Snow means winter: the engine's season tint (style.seasons.winter) whitens foliage and ground ----------
// The weather module sends no change event and a weather has no ground cover of its own, so the calendar day follows the weather each frame.
engine.onFrame(() => {
  const day = engine.weather?.name === 'snow' ? WINTER_DAY : 1;
  if (engine.calendar.day !== day) engine.calendar.day = day;
});

// ---------- 4. Views: an op, so the URL, the dev bridge and tests switch the same way ----------
const state = { view: params.view };
engine.ops.define('sheepisland.view', {
  desc: 'Move the camera to a named view: overview, flock, field, river, rim', args: { name: 'string' },
  can: (e, { name }) => VIEW_NAMES.includes(name) ? true : 'unknownView',
  run: (e, { name }) => {
    const cam = /** @type {any} */ (engine.cameraRig);
    for (const [n, v] of Object.entries(VIEWS)) cam.add(n, { position: v.pos, lookAt: v.look });
    state.view = name; cam.cut(name);
    return name;
  },
  reasons: { unknownView: 'View names: overview, flock, field, river, rim' },
});
engine.describe.add('sheepisland', () => ({ view: state.view, season: engine.calendar.season, weather: engine.weather?.name }));
engine.events.on('engine:ready', () => engine.ops.run('sheepisland.view', { name: params.view }));
if (params.badView) console.warn(`sheepisland: unknown view '${params.badView}', showing overview. Views: ${VIEW_NAMES.join(', ')}`);

engine.start();
window.engine = engine;   // handy for debugging in the browser console
