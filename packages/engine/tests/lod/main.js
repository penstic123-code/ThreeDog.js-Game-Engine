// Page for tests/specs/asset-lod.mjs: a model with levels as a plain THREE.LOD, switched by the renderer itself, and what must stay on the full model.
// The fixture box stands in for its own levels; each level has its own url, so the page can see whether a level was downloaded at all.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine, world, content, hlod, collision, threePatches } from '../../index.js';

const gpu = location.search.includes('r=gpu'), canvas = document.getElementById('view');
const renderer = gpu ? new TG.WebGPURenderer({ canvas, antialias: false, forceWebGL: true }) : new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
const engine = window.engine = createEngine({ renderer, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-lod' });
engine.use(world(), content(), hlod({ level: false }), collision());
engine.scene.add(new THREE.AmbientLight(0xffffff, 2));
// vite inlines the small fixture as a data: url, so each role gets its own blob url of the same bytes, and fetch is watched to see which were asked for
const bytes = await (await fetch(new URL('../fixtures/box-meshopt.glb', import.meta.url).href)).blob();
const [full, level1, level2, plain] = [0, 1, 2, 3].map(() => URL.createObjectURL(bytes));
const fetched = new Set(), realFetch = window.fetch;
window.fetch = (u, o) => { fetched.add(String(u?.url ?? u)); return realFetch(u, o); };
engine.assets.manifest({ name: 'lod-test', models: { tower: { url: full, lods: [level1, level2] }, plain } });
await engine.start();

const frames = async n => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)); };
const levelsSeen = () => [level1, level2].filter(u => fetched.has(u)).length;
const lowOf = l => { const out = []; for (const v of l.levels.slice(1)) v.object.traverse(m => { if (m.isMesh) out.push(m); }); return out; };
const fullOf = l => { const out = []; l.levels[0].object.traverse(m => { if (m.isMesh) out.push(m); }); return out; };
// this ray meets the box on the diagonal of a face, so two triangles of one mesh answer at one distance: that is plain three.js. Answered twice means the same triangle of the same mesh again
const ownHits = l => { const h = new THREE.Raycaster(new THREE.Vector3(0, 0, 50), new THREE.Vector3(0, 0, -1)).intersectObject(l, true); return { hits: h.length, faces: h.map(x => x.faceIndex), twice: h.length - new Set(h.map(x => x.object.uuid + ':' + x.faceIndex)).size, low: h.filter(x => x.object.userData.lodLevel).length, objects: h.map(x => x.object) }; };
const lookFrom = async (l, d) => { engine.camera.position.set(0, 0, d); engine.camera.lookAt(0, 0, 0); engine.camera.updateMatrixWorld(); await frames(3); return l.getCurrentLevel(); };

window.lodRun = async () => {
  const r = {};
  await engine.assets.model('tower');
  r.levelsAfterModel = levelsSeen();

  const t = await engine.assets.lod('tower');
  engine.add(t);
  r.isLod = t.isLOD; r.levels = t.levels.length; r.defaults = t.levels.map(l => l.distance); r.levelsAfterLod = levelsSeen();
  r.sameMaterial = lowOf(t).every(m => m.material === fullOf(t)[0].material);
  r.near = await lookFrom(t, 2);
  // WebGPU's shadow pass calls update with the shadow camera: a far camera that is not the view must not move the level
  const shadowCam = new THREE.OrthographicCamera(); shadowCam.position.set(0, 0, 2000); shadowCam.updateMatrixWorld();
  t.update(shadowCam); r.afterShadowCamera = t.getCurrentLevel();
  r.far = await lookFrom(t, 500);

  // far away level 0 is not drawn, and rays must still answer with it. Hidden by layer, not visible and not a field, the same way hlod does it
  const own = await engine.assets.lod('tower', { distances: [5, 9], hysteresis: 0 });
  r.own = own.levels.map(l => l.distance);
  r.statics = engine.rays.addStatic(t) && { full: fullOf(t).every(m => engine.rays.statics.has(m)), low: lowOf(t).some(m => engine.rays.statics.has(m)) };
  r.far0 = { drawn: fullOf(t).some(m => m.layers.test(engine.camera.layers)), visible: t.levels[0].object.visible, field: 'rayVisible' in t.levels[0].object.userData };
  const hit = engine.raycast({ x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: -1 });
  r.rayHitsFull = !!hit && fullOf(t).includes(hit.object);
  const { objects: mine, ...ownRay } = ownHits(t);
  r.ownRay = { ...ownRay, full: mine.every(o => fullOf(t).includes(o)) };

  // a copy taken far off keeps all of it: a far mask carried over with nobody to restore it would draw nothing when near
  const copy = t.clone();
  engine.remove(t);
  engine.add(copy); engine.rays.addStatic(copy);
  await lookFrom(copy, 500);
  const copyRay = engine.raycast({ x: 0, y: 0, z: 50 }, { x: 0, y: 0, z: -1 });
  const copyOwn = ownHits(copy);
  r.clone = { far: copy.getCurrentLevel(), farDrawn: fullOf(copy).some(m => m.layers.test(engine.camera.layers)), rayFull: fullOf(copy).includes(copyRay?.object), ownFull: copyOwn.hits > 0 && !copyOwn.twice && copyOwn.objects.every(o => fullOf(copy).includes(o)) };

  // a layer the game enables while far stands, and near the model is drawn with its old mask back
  fullOf(copy)[0].layers.enable(4);
  r.nearAgain = await lookFrom(copy, 2);
  r.backMask = fullOf(copy)[0].layers.mask;
  fullOf(copy)[0].layers.disable(4);
  const { objects: _, ...nearOwn } = ownHits(copy);
  r.nearOwn = nearOwn;
  engine.remove(copy);

  // collision measures the full model even when a level sticks out of it
  const wide = await engine.assets.lod('tower');
  wide.levels[1].object.scale.setScalar(10);
  const before = new THREE.Box3().setFromObject(wide.levels[0].object).getSize(new THREE.Vector3()).x;
  const addBox = engine.collision.addBox; let got = null;
  engine.collision.addBox = function (c, o) { got = o.halfWidth; return addBox.call(this, c, o); };
  engine.collision.addObject(wide).remove();
  engine.collision.addBox = addBox;
  r.collisionHalf = { want: before / 2, got };

  // batching: the same model many times under an engine content owner. Plain copies must batch (or this check proves nothing), LOD copies must not
  const copies = [], lods = [];
  for (let i = 0; i < 40; i++) {
    const p = await engine.assets.model('plain'), l = await engine.assets.lod('tower');
    p.position.set(i * 3, 0, -30); l.position.set(i * 3, 0, -60);
    engine.add(p, { owner: 'world' }); engine.add(l, { owner: 'world' }); copies.push(p); lods.push(l);
  }
  await frames(30);
  r.plainBatched = copies.filter(p => engine.batching.of(p).length).length;
  r.lodBatched = lods.filter(l => engine.batching.of(l).length).length;
  // the batch layer here can only be the far full model, never batching's doing: a level stays put, and the full model sits there exactly while a lower level shows
  r.lodLayers = lods.every(l => lowOf(l).every(m => m.layers.mask === 1) && fullOf(l).every(m => m.layers.mask === (l.getCurrentLevel() ? (1 << 31) >>> 0 : 1)));
  for (const o of [...copies, ...lods]) engine.remove(o);

  // hlod leaves a LOD object alone
  const g = new THREE.Group(), l = await engine.assets.lod('tower'), m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  g.add(l, m); engine.add(g);
  const h = engine.hlod.add(g);
  r.hlodOriginals = h.cells.flatMap(c => c.originals).map(o => o === m ? 'mesh' : 'lod');
  h.remove(); engine.remove(g);

  // one line in content: `lod` on a prop; the record stays plain data
  engine.content.load({ props: [{ id: 'lod-prop', model: 'tower', x: 0, y: 0, z: 0, lod: [5, 9], collide: 'box' }, { id: 'no-lod', model: 'tower', x: 4, y: 0, z: 0 }] });
  await frames(60);
  const rec = engine.world.records.get('lod-prop'), built = [];
  engine.scene.traverse(o => { if (o.isLOD && o.userData.name === 'tower') built.push(o); });
  r.prop = { built: built.length, distances: built[0]?.levels.map(l => l.distance), batch: built[0]?.userData.batch, record: JSON.stringify(rec) };

  r.noLevels = (await engine.assets.lod('plain')).levels.length;
  r.bad = await engine.assets.lod('tower', { distances: [9, 5] }).then(() => null, e => e.message);
  // last: threePatches.off is page-wide and has no way back
  threePatches.off('lod-view-camera');
  const plain = await engine.assets.lod('tower');
  r.offPlain = plain.update === THREE.LOD.prototype.update && plain.clone === THREE.LOD.prototype.clone;
  return r;
};
window.ready = true;
