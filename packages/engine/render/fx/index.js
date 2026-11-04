// threedog/tsl entry: the TSL Fn library.
// threedog/tsl: the engine's shader functions as TSL Fn, same signatures as the GLSL ones (WebGPU route only).
// Why a separate subpath: these files import three/tsl; the main entry index.js never imports this, so WebGL games' bundles do not grow.
// Import only three/tsl, three/webgpu and engine files that pull in nothing WebGL-only (effects.js registers ShaderChunks, so it stays out).
export { wind } from './wind.tsl.js';
export { cloudShadow } from './cloudShadow.tsl.js';
export { season } from './season.tsl.js';
export { objectOrigin } from './objectOrigin.tsl.js';
export { detailNoise, detailBump } from './detail.tsl.js';
export { wrapDiffuse, shadowTint, rim } from './lighting.tsl.js';
export { waterWave, waterSurface, waterFresnel } from './water.tsl.js';
export { uniforms } from './uniforms.tsl.js';
// Registers what a patch's `tsl` field does on a NodeMaterial (render/patches.js looks it up; nothing to call)
import './patchNodes.tsl.js';
// Registers the node versions of the particle / weather shaders (modules/particles and modules/weather drawing them up on WebGPURenderer)
import './particles.tsl.js';
// Registers the WebGPU post chain (render/PostFX.js looks it up when the renderer is a WebGPURenderer; nothing to call)
import './postWebGPU.tsl.js';
// Registers the node version of the sky dome (modules/sky looks it up on WebGPURenderer)
import './sky.tsl.js';
// Registers cascaded shadows as three's CSMShadowNode on the light (render/cascades.js looks it up on WebGPURenderer; nothing to call)
import '../cascades.tsl.js';
import { WebGPURenderer, PMREMGenerator, CubeRenderTarget, MeshBasicNodeMaterial } from 'three/webgpu';
import { registerWebGPUPart } from '../backend.js';
// createEngine({ renderer: 'webgpu' }) builds from these, so the engine core never imports three/webgpu itself (WebGL bundles stay as they are)
registerWebGPUPart('classes', Object.freeze({ WebGPURenderer, PMREMGenerator, CubeRenderTarget, MeshBasicNodeMaterial }));
