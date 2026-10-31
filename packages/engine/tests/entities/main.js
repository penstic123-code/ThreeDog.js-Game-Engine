// Test page: open world + entities + world edits + particles. Playwright inspects it through window.engine / window.T.
import { createEngine, presets, openWorld, interactions, entities, particles, THREE } from '../../index.js';
import lowpoly, { terrainPreset } from '@threedog/style-lowpoly';

const M = lowpoly.models;
localStorage.clear();
const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly, ui: { loading: false }, saveKey: 'enttest' });
engine.use(openWorld({ camera: 'follow', terrain: { seed: 1337, ...terrainPreset() }, sky: { time: 0.4, seasons: ['wet', 'dry'], daysPerSeason: 28 }, debug: false, ambience: false }), interactions({ ...presets.interactions.nearest }), entities(), particles());   // the preset only builds the world; gameplay modules are installed separately
engine.vegetation.add('松树', {
  geometry: M.pine(), lodGeometry: M.pineLow(),
  rule: { perChunk: 130, minHeight: 1.6, maxHeight: 40, maxSlope: 0.6, cluster: 'forest', scale: [0.75, 1.6], stretch: [0.85, 1.2], sink: 0.15,
    biomes: { forest: 1, meadow: 0.35, snow: 0.6, wetland: 0.3, riverbank: 0.3 }, collider: 0.35 },
  wind: 0.022,
});
engine.vegetation.add('石头', { geometry: M.rock(), rule: { perChunk: 14, chance: 0.6, minHeight: 0.5, maxHeight: 70, maxSlope: 2, scale: [0.4, 1.6], collider: 0.6 }, maxRing: 3 });
engine.characters.createPlayer({ ...presets.player.thirdPerson, spawn: { x: 0, z: 0 } });

const mat = new THREE.MeshLambertMaterial({ color: 0x88aa66 });
engine.entities.define('sapling', {
  create: () => new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 6).translate(0, 1, 0), mat),
  state: { watered: false },
  stages: [{ name: 'seed', duration: 2, scale: 0.2 }, { name: 'sapling', duration: 2, scale: 0.5 }, { name: 'tree', model: () => new THREE.Mesh(new THREE.ConeGeometry(1, 4, 6).translate(0, 2, 0), mat) }],
  interact: { label: 'entities.use', onUse: ent => ent.set('watered', true) },
});
engine.particles.define('dust', { max: 200, lifetime: [0.4, 0.8] });
engine.particles.define('smoke', { max: 200, lifetime: [0.5, 1], gravity: 1, rate: 40 });

window.engine = engine; window.THREE = THREE;
window.errors = [];
engine.start();
