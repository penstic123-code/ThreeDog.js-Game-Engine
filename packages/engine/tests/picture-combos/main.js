// Picture combos page (tests/specs/picture-combos.mjs). Why: the engine's switches (renderer route, shadows, post effects, fog, quality preset, camera kind, lights) are
// each tested alone; this page is one plain scene (ground, box, sphere) with a sun and a point light the spec can turn on and off, so the spec can try combinations.
// The page only builds and exposes things; the spec decides the combination. URL: route=webgpu (fallback webgl2 on the software test machine) or webgl.
import * as THREE from 'three';
import 'threedog/tsl';
import { createEngine, world, settings } from '../../index.js';
import { bloom, vignette, grain } from '@threedog/post-effects';

const q = new URLSearchParams(location.search);
const engine = window.engine = createEngine({ canvas: document.getElementById('c'), lights: false, ui: { loading: false }, urlState: false, saveKey: 'test-picture-combos',
  adaptiveResolution: false, ...(q.get('route') === 'webgpu' ? { renderer: 'webgpu', fallback: q.get('fallback') ?? 'webgl2' } : {}) });
engine.use(world(), settings());
await engine.start();
engine.haltLoop();
engine.scene.background = new THREE.Color(0x203040);

const mk = (g, color, x, y, z) => { const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color })); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; engine.add(m); return m; };
const ground = mk(new THREE.PlaneGeometry(20, 20), 0x88aa66, 0, 0, 0); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
mk(new THREE.BoxGeometry(1.5, 1.5, 1.5), 0xcc6644, -1.2, 0.75, 0);
mk(new THREE.SphereGeometry(0.9, 24, 16), 0x4466cc, 1.4, 0.9, 0.5);
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(4, 8, 5); sun.shadow.mapSize.set(512, 512); engine.scene.add(sun);
engine.scene.add(new THREE.HemisphereLight(0xaaccff, 0x445533, 0.6));
const point = new THREE.PointLight(0xffd080, 30, 12); point.position.set(0, 2.5, 2); point.visible = false; engine.scene.add(point);

engine.camera.position.set(0, 4, 8); engine.camera.lookAt(0, 0.8, 0);
const persp = engine.camera, ortho = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100); ortho.position.copy(persp.position); ortho.lookAt(0, 0.8, 0);
const effects = { bloom: () => bloom(), vignette: () => vignette(), grain: () => grain() };

/** One draw, then the canvas is copied and read in the same task (as picture-freedom does); returns the whole frame */
const read = () => {
  engine.renderOnce();
  const src = engine.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
  return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};
window.combos = { THREE, engine, sun, point, effects, read, persp, ortho };
window.ready = true;
