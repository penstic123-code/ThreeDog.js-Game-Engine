// Asset gallery with node materials (tests/specs/gallery-webgpu.mjs): the gallery (@threedog/tools/gallery, used by `threedog gallery --shots`
// and the preview of `threedog lib add`) once drew with a WebGLRenderer only, so a model with a TSL material came out as an empty turntable.
// Two engines register the same pair of models (a node material box and a classic one): one on the WebGPU route, one on WebGL, where the
// gallery must still pick a WebGPURenderer because an asset carries a node material.
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import { color } from 'three/tsl';
import 'threedog/tsl';
import { shots, openGallery, hasNodeMaterial } from '@threedog/tools/gallery';
import { createEngine } from '../../index.js';

const box = material => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
const models = {
  nodeBox: () => { const m = new TG.MeshStandardNodeMaterial({ roughness: 1 }); m.colorNode = color(0xff1010); return box(m); },
  plainBox: () => box(new THREE.MeshStandardMaterial({ color: 0x1030ff, roughness: 1 })),
};

async function make(extra) {
  const e = createEngine({ canvas: Object.assign(document.createElement('canvas'), { width: 160, height: 120 }), lights: false, ui: { loading: false },
    urlState: false, saveKey: 'test-gallery-webgpu', ...extra });
  e.assets.manifest({ models });
  await e.start();
  e.pause();
  return e;
}

/** Share of pixels (%) in the middle third of a PNG where channel ch clearly leads the other two (the box's own color) */
async function boxShare(png, ch) {
  const img = new Image(); img.src = png; await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const t = Math.floor(img.width / 3), d = x.getImageData(t, t, t, t).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = [d[i], d[i + 1], d[i + 2]], other = Math.max(...v.filter((_, k) => k !== ch));
    if (v[ch] > 60 && v[ch] > 1.8 * other) n++;
  }
  return +(100 * n / (t * t)).toFixed(1);
}

window.engine = await make({ renderer: 'webgpu' });

window.galleryNodeMaterials = async () => {
  const out = { node: hasNodeMaterial(models.nodeBox()), plain: hasNodeMaterial(models.plainBox()) };
  for (const [route, e] of [['gpu', window.engine], ['gl', await make({})]]) {
    const list = await shots(e, { size: 96, only: ['nodeBox', 'plainBox'] });
    const r = { renderer: e.renderer.isWebGPURenderer ? 'webgpu' : 'webgl', errors: list.filter(s => s.error).map(s => `${s.name}: ${s.error}`), count: list.length };
    const midday = n => list.find(s => s.name === n && s.light === 'midday')?.png;
    r.nodeRed = midday('nodeBox') ? await boxShare(midday('nodeBox'), 0) : -1;
    r.plainBlue = midday('plainBox') ? await boxShare(midday('plainBox'), 2) : -1;
    out[route] = r;
    if (route === 'gl') e.dispose();
  }
  // the live grid (?gallery=1): each cell is a canvas the picture is copied into; the node material box's midday cell shows its red
  const g = await openGallery(window.engine);
  for (let i = 0; i < 4; i++) await new Promise(res => requestAnimationFrame(res));
  const cell = [...document.querySelectorAll('canvas[title]')].find(c => c.title === 'nodeBox · midday');
  out.live = cell ? await boxShare(cell.toDataURL('image/png'), 0) : -1;
  g.close();
  out.liveGone = !document.querySelector('canvas[title]');
  return out;
};
