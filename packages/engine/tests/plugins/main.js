// Plugins folder page (tests/specs/plugins-folder.mjs). On purpose this file has NO plugin line: the four files in ./plugins/ (a mesh, a
// three.js Pass, a material patch, a module) must be plugged by the vite preset + engine.start() alone. If a registration line ever
// becomes necessary here, the plugins folder is broken.
import * as THREE from 'three';
import { createEngine } from '../../index.js';

const canvas = document.body.appendChild(Object.assign(document.createElement('canvas'), { width: 160, height: 120 }));
const engine = window.engine = createEngine({ canvas, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, urlState: false, saveKey: 'test-plugins' });
window.threedogTest = { THREE };
await engine.start();
engine.haltLoop();
