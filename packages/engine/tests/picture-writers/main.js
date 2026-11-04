// Page for the picture-writers guard (packages/tools/tests/picture-writers.mjs): a picture/ folder wired the usual way, one engine.onRender calling parts in
// separate files, so only the stack of a write can tell them apart. window.mode picks what the parts do; the guard flips it while the page runs.
import * as THREE from 'three';
import { createEngine } from 'threedog';
import { createLights } from './picture/lights.js';
import { createSky } from './picture/sky.js';
import { createRival } from './picture/rival.js';

const engine = createEngine({ canvas: document.getElementById('c'), lights: false });
window.engine = engine;
const parts = [createLights(engine), createSky(engine), createRival(engine)];
const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0x808080 }));
box.material.name = 'box';
engine.scene.add(box);
engine.onRender(() => { for (const p of parts) p.update(); });
window.picture = { box };
await engine.start();
