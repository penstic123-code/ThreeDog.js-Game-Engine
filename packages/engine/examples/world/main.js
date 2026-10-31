// Open-world example (slow photography life): riverside cabin + an old fisherman who walks by the clock + pickups, quests, weather, photos, saves.
// This file only holds: installing engine modules, computing place coordinates, handing content/ to the engine, and game-specific logic. Items/NPCs/dialogues/quests/vegetation/props live in content/.
import { createEngine, openWorld, content, interactions, dialogue, inventory, quests, photo, timeline, triggers, entities, particles, music, hud, createTerrain, THREE, mergeColored, makeMaterial, toast } from '../../index.js';
import lowpoly from '../../styles/lowpoly/index.js';   // style pack: all the art is here
import data from './content/index.js';

// ---------- 0. Pick a flat spot as home ----------
// Preview the terrain with the same seed, find a good spot, then tell the engine to flatten it
const SEED = 1337;
const preview = createTerrain({ seed: SEED });
let home = { x: 0, z: 0 };
for (let r = 0; r < 3000; r += 10) {
  const a = r * 0.37, x = Math.cos(a) * r, z = Math.sin(a) * r, h = preview.surface(x, z);
  if (h > 4 && h < 10 && preview.slope(x, z) < 0.2 && preview.riverFactor(x, z) === 0) { home = { x, z }; break; }
}

// core + style pack + open-world preset (world and environment: terrain, vegetation, sky, weather, water, collision, physics, camera, characters, ambience, settings, debug) + the gameplay modules this game needs
const engine = createEngine({ canvas: document.getElementById('view'), style: lowpoly, ui: { loading: { title: '慢慢走' } } });
engine.use(openWorld({ seed: SEED, flatten: [{ x: home.x, z: home.z, radius: 22 }], time: 0.3, autoWeather: true }),
  interactions(), dialogue(), inventory(), quests(), photo(), timeline(), triggers(), entities(), particles(), music(), hud(),   // gameplay modules: not in the preset, this game uses them all
  content());

// ---------- 1. Places: nearest riverside to the cabin (fisherman goes there in the morning, barrel floats there) ----------
let river = { x: home.x + 30, z: home.z }, waterSpot = { x: home.x + 34, z: home.z };
search: for (let r = 10; r < 400; r += 4) {
  for (let a = 0; a < 6.28; a += 0.3) {
    const x = home.x + Math.cos(a) * r, z = home.z + Math.sin(a) * r;
    if (engine.surface(x, z) < engine.waterLevel - 1.2) { river = { x: home.x + Math.cos(a) * (r - 8), z: home.z + Math.sin(a) * (r - 8) }; waterSpot = { x, z }; break search; }
  }
}

// ---------- 2. Cabin: procedural low-poly house with collision and a smoking chimney ----------
function makeHouse() {
  const g = mergeColored([
    [new THREE.BoxGeometry(6, 3, 5).translate(0, 1.5, 0), 0xe8dcc4],
    [new THREE.ConeGeometry(4.8, 2.6, 4).rotateY(Math.PI / 4).scale(1.05, 1, 0.9).translate(0, 4.3, 0), 0xa4553c],
    [new THREE.BoxGeometry(1.1, 2, 0.12).translate(0, 1, 2.52), 0x6b4a32],
    [new THREE.BoxGeometry(1, 0.9, 0.1).translate(-1.8, 1.7, 2.52), 0x9cc6d6],
    [new THREE.BoxGeometry(0.6, 1.6, 0.6).translate(1.8, 5, -0.8), 0x7d736a],
  ]);
  const m = new THREE.Mesh(g, makeMaterial('building', { vertexColors: true }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const house = makeHouse();
house.position.set(home.x, engine.surface(home.x, home.z) - 0.05, home.z);
engine.add(house);
const chimney = new THREE.Object3D(); chimney.position.set(1.8, 6, -0.8); house.add(chimney);
engine.particles.attach('smoke', chimney);
engine.collision.addBox(home, { halfWidth: 3.1, halfDepth: 2.6 });

// Doorway lamp: on 18:00-06:00 (time-range switch: re-aligns automatically after start, load, applying a scenario, or rewinding time)
// makeMaterial is typed as the base Material (the style picks the class); this one is lit, so it has emissiveIntensity
const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), /** @type {THREE.MeshLambertMaterial} */ (makeMaterial('lamp', { color: 0x6b5a40, emissive: 0xffc070, emissiveIntensity: 0 })));
lamp.position.set(0.9, 2.3, 2.7); house.add(lamp);
engine.sky.between('18:00', '06:00', { on: () => { lamp.material.emissiveIntensity = 1.6; }, off: () => { lamp.material.emissiveIntensity = 0; } });

// ---------- 3. Player + content (vegetation, items, pickups, NPCs, dialogues, quests, key actions, props, custom conditions) ----------
engine.characters.createPlayer({ spawn: { x: home.x + 4, z: home.z + 7 } });
engine.content.load(data, { places: { home, river } });   // models default to the style pack's lowpoly.models

// Show the film count at the top left (hud counter)
const showFilm = () => engine.hud.counter('film', { icon: '🎞', label: '胶卷', value: engine.inventory.count('film') });
for (const ev of ['item:add', 'item:remove', 'load']) engine.events.on(ev, showFilm);
showFilm();

// Barter: the fisher's basket (content/containers.js) sells goods for film. An op, so the dialogue choice, the dev bridge and scenario tests share one rule
const PRICE = { berry: 1, feather: 2 };   // film per item
engine.ops.define('barter.buy', {
  desc: 'Buy from a basket, paying in film', args: { shop: 'string', item: 'string' },
  can(e, { shop, item }, ctx) {
    if (!e.inventory.container(shop).has(item)) return 'soldOut';
    return e.inventory.container(ctx.actor).has('film', PRICE[item] ?? 1) ? true : 'noFilm';
  },
  run(e, { shop, item }, ctx) {
    const got = e.inventory.transfer(shop, ctx.actor, item, 1);
    e.inventory.transfer(ctx.actor, shop, 'film', (PRICE[item] ?? 1) * got);
    return got;
  },
  offers: () => Object.keys(PRICE).map(item => ({ shop: 'fisher-basket', item })),
  reasons: { soldOut: 'The basket has none left', noFilm: 'Not enough film' },
});

// ---------- 4. Photos: use film; evening shots count toward quest progress; album strip ----------
engine.photo.canTake = () => engine.inventory.has('film') || 'noFilm';   // the op photo.take's can: no film, no photo (the P key runs the op)
engine.events.on('photo:denied', () => toast(engine, '没有胶卷了'));
engine.events.on('photo:taken', () => {
  engine.inventory.remove('film');
  const t = engine.sky.timeOfDay;
  if (t > 17 / 24 && t < 19 / 24) engine.vars.bump('sunsetPhotos');
});
const strip = document.getElementById('strip');
engine.events.on('photo:taken', shot => {
  const img = new Image(); img.src = shot.url; img.alt = `${shot.time} 拍摄`; img.title = shot.time;
  img.onclick = () => { /** @type {HTMLImageElement} */ (document.getElementById('viewerImg')).src = shot.url; document.getElementById('viewer').hidden = false; };
  strip.prepend(img);
  while (strip.children.length > 8) strip.lastChild.remove();
  const fl = document.getElementById('flash'); fl.style.transition = 'none'; fl.style.opacity = '0.8';
  requestAnimationFrame(() => { fl.style.transition = ''; fl.style.opacity = '0'; });
});
document.getElementById('shoot').onclick = () => { if (!engine.ops.run('photo.take').ok) toast(engine, '没有胶卷了'); };
document.getElementById('viewerClose').onclick = () => { document.getElementById('viewer').hidden = true; };

// ---------- 5. Save / load (keys in content/actions.js) ----------
engine.onFrame(() => {
  if (engine.input.pressed('save')) { engine.saves.save('slot1').then(ok => { if (ok) toast(engine, '已存档'); }); }   // on false the engine already said why
  if (engine.input.pressed('load')) { if (engine.saves.load('slot1')) toast(engine, '已读档'); else toast(engine, '还没有存档'); }
});
engine.saves.autosave(3);

// ---------- 6. Real physics: crate, ball, and a barrel floating by the river; press F to push/kick ----------
engine.events.on('world:ready', () => {
  if (!engine.rigid) return;
  const crateGeo = mergeColored([[new THREE.BoxGeometry(0.8, 0.8, 0.8), 0xb08850]]);
  const crateMat = makeMaterial('prop', { vertexColors: true });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(crateGeo, crateMat);
    const x = home.x + 5 + (i % 3) * 0.85, z = home.z - 1 + Math.floor(i / 3) * 0.9;
    m.position.set(x, engine.surface(x, z) + 0.45, z);
    m.castShadow = m.receiveShadow = true;   // rigid bodies do not change the model's shadow settings
    engine.rigid.addBox(m, { mass: 4 });
  }
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), makeMaterial('prop', { color: 0xe8c25a, flatShading: true }));
  ball.position.set(home.x + 2, engine.surface(home.x + 2, home.z + 9) + 1, home.z + 9); ball.castShadow = true;
  engine.rigid.addBall(ball, { radius: 0.35, mass: 1, restitution: 0.55, angularDamping: 0.3 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.9, 8), makeMaterial('prop', { color: 0x8a5a36, flatShading: true }));
  barrel.position.set(waterSpot.x, Math.max(engine.waterLevel, engine.surface(waterSpot.x, waterSpot.z)) + 1.5, waterSpot.z); barrel.castShadow = true;
  engine.rigid.addHull(barrel, { mass: 3 });
});
engine.onFrame(() => {
  if (!engine.rigid?.ready || !engine.input.pressed('kick')) return;
  const p = engine.player.position, f = engine.player.facing;
  const dir = { x: Math.sin(f), z: Math.cos(f) };
  let best = null, bestD = 2.6;
  for (const b of engine.rigid.bodies) {
    const t = b.body.translation(), d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < bestD && (t.x - p.x) * dir.x + (t.z - p.z) * dir.z > 0) { best = b; bestD = d; }
  }
  if (best) { const m = best.body.mass(); engine.rigid.impulse(best, [dir.x * 6 * m, 2.5 * m, dir.z * 6 * m]); }
});

// ---------- 7. Chop trees (world-change record: chopped trees are saved and regrow after 2 minutes) ----------
// An op, so the key, the dev bridge and tests share it and the wood lands in a fixed step, not a frame callback
const nearTree = (e, ctx) => {
  const p = e.world?.get(ctx.actor)?.position ?? e.player.position;
  return e.vegetation.instanceAt(p, { radius: 2.5, species: '松树' }) || e.vegetation.instanceAt(p, { radius: 2.5, species: '圆树' });
};
engine.ops.define('tree.chop', {
  desc: 'Chop the nearest tree for wood',
  can: (e, a, ctx) => nearTree(e, ctx) ? true : 'noTree',
  run(e, a, ctx) {
    const tree = nearTree(e, ctx);
    e.vegetation.removeInstance(tree.species, tree.cx, tree.cz, tree.id, { regrowSeconds: 120 });
    e.particles.emit('leaves', { x: tree.position.x, y: tree.position.y + 3, z: tree.position.z }, { count: 30 });
    e.inventory.add('wood', 2);
  },
  reasons: { noTree: 'No tree within 2.5 m' },
});
engine.onFixed(() => {
  if (engine.input.pressed('chop') && !engine.ops.run('tree.chop', {}, { source: 'player' }).ok) toast(engine, '附近没有树');
});
// Landing dust
engine.events.on('character:land', ({ character, impact }) => {
  if (impact > 4) engine.particles.emit('dust', character.position, { count: Math.min(40, Math.round(impact * 4)) });
});

// ---------- 8. Intro camera (circles the cabin, Esc skips) ----------
engine.events.on('world:ready', () => {
  const h = engine.surface(home.x, home.z);
  engine.timeline.play([
    { camera: { to: { position: [home.x + 30, h + 18, home.z + 30], lookAt: [home.x, h + 2, home.z] }, duration: 0.01 } },
    { camera: { to: { position: [home.x - 20, h + 10, home.z + 25], lookAt: [home.x, h + 2, home.z] }, duration: 5, ease: 'inOutSine' } },
    { camera: { release: true } },
  ], { letterbox: true });
});

engine.start();
window.engine = engine;   // handy for debugging in the browser console
