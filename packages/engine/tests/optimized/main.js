// Page for tests/specs/optimized.mjs: loads a model made by `threedog assets optimize` (Meshopt geometry, KTX2 textures: color map ETC1S / sRGB, normal map UASTC / linear)
// and reports what each renderer made of it. ?r=gpu runs WebGPURenderer (forceWebGL: true in ordinary runs, real WebGPU through packages/tools/real-webgpu.mjs).
import * as THREE from 'three';
import * as TG from 'three/webgpu';
import 'threedog/tsl';
import { createEngine } from '../../index.js';

const gpu = location.search.includes('r=gpu'), canvas = document.getElementById('view');
const renderer = gpu ? new TG.WebGPURenderer({ canvas, antialias: false, forceWebGL: true }) : new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
const engine = window.engine = createEngine({ renderer, pixelRatio: 1, adaptiveResolution: false, ui: { loading: false }, saveKey: 'test-optimized', urlState: false });
engine.scene.background = new THREE.Color(0x203040);
engine.scene.add(new THREE.AmbientLight(0xffffff, 2.5));

await engine.start();
engine.haltLoop();

/** Load the model, draw it, and report the textures plus the average color of the middle of the picture */
window.optimizedRun = async () => {
  const model = await engine.assets.model(new URL('../fixtures/optimized-crate.glb', import.meta.url).href);
  engine.scene.add(model);
  model.position.set(-0.5, -0.5, 0);
  engine.camera.position.set(0, 0, 1.6); engine.camera.lookAt(0, 0, 0);
  engine.renderOnce(); await new Promise(r => requestAnimationFrame(r)); engine.renderOnce();
  let mat = null; model.traverse(o => { if (o.isMesh) mat = o.material; });
  const tex = t => t && { compressed: !!t.isCompressedTexture, colorSpace: t.colorSpace, mips: t.mipmaps?.length ?? 0, w: t.image?.width ?? t.mipmaps?.[0]?.width, h: t.image?.height ?? t.mipmaps?.[0]?.height, format: t.format };
  const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
  const cx = c2.getContext('2d'); cx.drawImage(canvas, 0, 0);
  const px = cx.getImageData(canvas.width / 2 - 8, canvas.height / 2 - 8, 16, 16).data;
  let r = 0, g = 0, b = 0; for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
  const n = px.length / 4;
  return { ktx2Loader: !!engine.assets.ktx2, map: tex(mat?.map), normalMap: tex(mat?.normalMap), mean: [r / n, g / n, b / n].map(Math.round), size: [canvas.width, canvas.height] };
};
window.ready = true;
