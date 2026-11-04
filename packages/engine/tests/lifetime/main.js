// Lifetime test page: builds and disposes engines (WebGL and WebGPURenderer) so specs can check shared resources, repeated create / dispose and coexistence with other Object3D.add wrappers.
import * as THREE from 'three';
import 'threedog/tsl';
import { createEngine, terrain, vegetation, water, sky, particles, weather, mergeColored } from '../../index.js';
import { threePatches } from '../../core/threePatches.js';

/** An engine with a few engine parts on; extra overrides createEngine options (renderer: 'webgpu', headless ...) */
function make(extra = {}, parts = true) {
  const canvas = Object.assign(document.createElement('canvas'), { width: 96, height: 64 });
  const e = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, antialias: false, ui: { loading: false }, urlState: false, saveKey: 'test-lifetime', headless: true, ...extra });
  if (parts) {
    e.use(terrain({ height: (x, z) => Math.sin(x * 0.15) * 1.5 + Math.cos(z * 0.12), viewChunks: 1 }), vegetation(), water({ sea: true, level: -0.4 }), sky({ time: 0.4 }), particles(), weather({ types: { wet: { rain: 1 } } }));
    e.vegetation.define('tree', { geometry: mergeColored([[new THREE.ConeGeometry(0.8, 3, 6).translate(0, 1.5, 0), 0x3c7a34]]), wind: 0.08, rule: { perChunk: 20 } });
    e.particles.define('puff', { rate: 0, max: 30, color: [0xffffff, 0xffeeaa], size: [0.6, 0.6], lifetime: [100, 100], speed: [0, 0] });
  }
  return e;
}
window.lifetime = { THREE, createEngine, make, threePatches };
// the test runner waits for window.engine: a bare headless engine on the page canvas (specs build their own with make())
const engine = window.engine = createEngine({ canvas: document.getElementById('view'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'test-lifetime-page' });
engine.start();
