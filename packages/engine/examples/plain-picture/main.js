// @ts-check
// Plain-picture demo (page /plain-picture.html): a night street in a flat-illustration look where the whole picture is plain three.js in picture/.
// The engine only gives time (calendar), signals (engine.uniforms, engine.weather) and a camera; its own lights, sky light / fog drivers are off.
// This file is the "world": shapes and where things stand. Colors and lights come from picture/, so the picture lives in one folder.
// URL: ?time=HH:MM (the engine reads it) &weather=rain
import { createEngine, calendar, sky, weather, fixedCamera, presets, THREE } from '../../index.js';
import { createPicture } from './picture/index.js';

const engine = createEngine({ canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('view')), ui: { loading: false },
  saveKey: 'threedog-plain-picture', lights: false });
engine.use(calendar({ ...presets.calendar.fixedTime, time: '22:00' }),
  sky(),   // the sky still computes the signals (uSunDir, uDaylight, uSkyTop ...), writes no light or fog
  weather({ types: { clear: {}, rain: { rain: 1, cloud: 0.8, fog: 0.6 } } }),
  fixedCamera({ shots: { street: { position: [2.5, 1.8, 14], lookAt: [-1, 2.6, -20] } }, start: 'street' }));

const picture = createPicture(engine);
const add = (/** @type {THREE.BufferGeometry} */ g, /** @type {THREE.Material} */ m, /** @type {number[]} */ [x, y, z]) => {
  const mesh = new THREE.Mesh(g, m); mesh.position.set(x, y, z); engine.scene.add(mesh); return mesh;
};

// ground: road, two sidewalks
add(new THREE.PlaneGeometry(10, 160).rotateX(-Math.PI / 2), picture.mat.road, [0, 0, -50]);
for (const x of [-6.5, 6.5]) add(new THREE.BoxGeometry(3, 0.15, 160), picture.mat.walk, [x, 0.075, -50]);

// facades: a row of houses on each side, heights and colors varied by a fixed pattern (no randomness: screenshots stay the same)
const walls = [picture.mat.wallA, picture.mat.wallB, picture.mat.wallC, picture.mat.wallD];
for (const side of [-1, 1]) for (let z = 10, i = 0; z > -110; z -= 9, i++) {
  const h = 6 + ((i * 5 + (side > 0 ? 2 : 0)) % 4) * 2, w = 8.6;
  add(new THREE.BoxGeometry(6, h, w), walls[(i + (side > 0 ? 1 : 0)) % 4], [side * 11, h / 2, z]);
  add(new THREE.BoxGeometry(6.6, 0.4, w + 0.3), picture.mat.roof, [side * 11, h + 0.2, z]);   // a darker cap line, like an outline at the roof
  for (let fy = 2; fy < h - 1; fy += 2.6) for (const dz of [-2.4, 0, 2.4]) {
    const lit = (i * 3 + Math.round(fy) + dz + side) % 3 !== 0;
    add(new THREE.PlaneGeometry(1.1, 1.4).rotateY(-side * Math.PI / 2), lit ? picture.mat.windowLit : picture.mat.windowDark, [side * 7.99, fy, z + dz]);
  }
  add(new THREE.PlaneGeometry(1.4, 2.2).rotateY(-side * Math.PI / 2), picture.mat.door, [side * 7.98, 1.1, z + 3.4]);
}

// street lamps on alternating sides
for (let z = 8, i = 0; z > -110; z -= 12, i++) {
  const x = i % 2 ? 5.4 : -5.4;
  add(new THREE.CylinderGeometry(0.09, 0.11, 5, 8), picture.mat.pole, [x, 2.5, z]);
  add(new THREE.SphereGeometry(0.32, 12, 8), picture.mat.lampHead, [x, 5.2, z]);
  picture.addLamp(x, 5.0, z);
}

Object.assign(window, { engine, picture });
engine.start();
