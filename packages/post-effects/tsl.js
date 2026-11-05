// @threedog/post-effects/tsl: post effects that exist only as TSL nodes, for games that chose WebGPU when they started.
//   import { voxelGI, temporalAA } from '@threedog/post-effects/tsl';
//   engine.post.add(voxelGI({ bounds })); engine.post.add(temporalAA());
// Why a subpath and not the main entry: these import three's vxgi and display nodes, which import three/webgpu; a WebGL game never loads this file, so its bundle stays as it is.
// Everything here is plain three.js plugged into engine.post: voxelGI and sunShafts hand three's node back through setup(), so its settings stay the game's.
// Default order in the hdr slot, low first, one scale with the main entry: voxelGI 2 (the bounce is scene light, so the rest works on it), dof 5, outline 10, ao 20, bloom 30,
// sunShafts and lightVolumes 200, temporalAA 900 (last: it clears the dots of everything before it).
// Tier rule as in index.js: of these only voxelGI declares skipOnLowTier. Each effect is held, and describe().render.post says why, on a device where start() fell back to WebGLRenderer;
// voxelGI also on WebGPURenderer's WebGL2 backend. On a WebGLRenderer the game chose, adding any of them throws by name.
import { vxgi } from 'three/addons/lighting/vxgi/VXGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { depthAwareBlend } from 'three/addons/tsl/display/depthAwareBlend.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { bayer16 } from 'three/addons/tsl/math/Bayer.js';
import { Box3, BoxGeometry, Color, Layers, Mesh, Vector3, VolumeNodeMaterial } from 'three/webgpu';
import { RESERVED_LAYERS } from 'threedog/layers';
import { codedError } from 'threedog/error-hints';
/** @import { PostEffect } from 'threedog' */

const { lightVolumes: VOLUME_LAYER } = RESERVED_LAYERS;

/**
 * Real-time bounced light from a voxel volume (three's vxgi), added to the scene color in the hdr slot. Only on three's WebGPU backend; held off on low tier.
 * Light may move every frame (three notices); geometry that moves needs a new voxelization, too slow per frame, so keep moving things out of the volume
 * (gi.volume.layers) and call gi.needsUpdate = true only for a rare change. It injects direct light only: sky light stays the game's. Metal counts as diffuse.
 * What occlusion culling hides stays in the volume (its layer is on gi.volume.layers; setup can take it off). Changing any effect of the chain rebuilds the chain, which voxelizes the scene again: a stall.
 * @param {{ resolution?: number, bounds?: import('three').Box3, intensity?: number, occlusion?: number, setup?: (gi: any) => void, order?: number, enabled?: boolean, name?: string }} [o]
 *   resolution: voxels along the longest side; bounds: the part of the world to voxelize (default: the whole scene, so a far sky mesh makes voxels huge);
 *   intensity: how strong the bounce is; occlusion: 0 to 1, how much the voxel occlusion darkens the picture (it darkens direct light too, so it starts at 0);
 *   setup(gi): gets three's VXGINode each time the chain builds it (coneCount, volume.bounces ...).
 * @returns {PostEffect}
 */
export function voxelGI({ resolution = 128, bounds, intensity = 1, occlusion = 0, setup, order = 2, enabled, name = 'voxelGI' } = {}) {
  /** @type {any} */ let gi = null;
  return { name, slot: 'hdr', order, enabled, backend: 'webgpu', skipOnLowTier: true, needsBuffers: ['normal', 'diffuse'], params: { intensity, occlusion },
    node(input, ctx) {
      const { tsl, p, scenePass, scene, camera, display } = ctx;
      gi = display.own(vxgi(scenePass.getTextureNode('depth'), scenePass.getTextureNode('normal'), scene, camera, resolution));
      display.own({ dispose() { gi = null; } });
      gi.volume.layers.enable(RESERVED_LAYERS.occlusionHidden);   // a wall out of the camera's sight still throws its color
      if (bounds) gi.volume.bounds.copy(bounds);
      setup?.(gi);
      const light = gi.getGINode().rgb.mul(scenePass.getTextureNode('diffuse').rgb).mul(p.intensity);
      return tsl.vec4(input.rgb.mul(tsl.mix(tsl.float(1), gi.getAONode().r, p.occlusion)).add(light), input.a);
    },
    // voxelSize is 0 until the first frame voxelized the scene
    facts: () => (gi ? { resolution, voxelSize: +gi.volume.voxelSizeNode.value.toFixed(3) } : null) };
}

/**
 * Temporal antialiasing (three's TRAANode): averages jittered frames, so it also clears the dots of every stochastic effect before it (voxelGI, lightVolumes).
 * Runs last in the hdr slot. It replaces MSAA while it is on. Moving things can trail; judge it in motion.
 * @param {{ order?: number, enabled?: boolean, name?: string }} [o]
 * @returns {PostEffect}
 */
export function temporalAA({ order = 900, enabled, name = 'temporalAA' } = {}) {
  return { name, slot: 'hdr', order, enabled, needsBuffers: ['velocity'],
    node: (input, { scenePass, camera, display }) => display.own(traa(input, scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera)) };
}

/**
 * Light shafts from the sun (or a point light) through gaps, from its shadow map (three's GodraysNode), blended over the picture in the hdr slot. The light and the things that make the
 * gaps must cast shadows. It lights the air everywhere the shadow map says is lit, so a big open scene turns to haze: it reads best where most of the air is in shadow (a room with a window).
 * @param {{ light?: any, density?: number, maxDensity?: number, falloff?: number, color?: any, steps?: number, setup?: (rays: any) => void, order?: number, enabled?: boolean, name?: string }} [o]
 *   light: default engine.lights.sun; one that is not in the scene or casts no shadow throws by name; density and maxDensity: how thick the air is, and the ceiling of what one pixel can gather; falloff: how fast the shafts fade away from the light;
 *   setup(rays): gets three's GodraysNode each time the chain builds it.
 * @returns {PostEffect}
 */
export function sunShafts({ light, density = 2, maxDensity = 0.6, falloff = 2, color = new Color(1, 1, 1), steps = 60, setup, order = 200, enabled, name = 'sunShafts' } = {}) {
  return { name, slot: 'hdr', order, enabled, params: { density, maxDensity, falloff, color: new Color(color) },
    node(input, { engine, tsl, p, scenePass, camera, display }) {
      const depth = scenePass.getTextureNode('depth'), sun = light ?? engine.lights?.sun;
      // engine.lights.sun exists even under createEngine({ lights: false }), out of the scene; three's own error for a light with no shadow map names nothing
      if (!sun?.parent || !sun.castShadow) throw codedError('post-effect', 'sunShafts: no light to follow; give sunShafts({ light }) a light that is in the scene and casts shadows (default: engine.lights.sun)');
      const rays = display.own(godrays(depth, camera, sun));
      Object.assign(rays, { density: p.density, maxDensity: p.maxDensity, distanceAttenuation: p.falloff });
      rays.raymarchSteps.value = steps;
      setup?.(rays);
      const blended = depthAwareBlend(display.texture(input), rays.getTextureNode(), depth, camera, { blendColor: p.color });
      return tsl.vec4(blended.rgb, input.a);
    } };
}

/**
 * Lit air inside a box: spot light cones and point light glows with their shadows (three's VolumeNodeMaterial), drawn at a fraction of the screen size (scale), blurred and added in the hdr slot.
 * Reads point and spot lights only: three skips lights at infinity, so the sun and directional lights do nothing here (use sunShafts). Dithered, so temporalAA after it clears the pattern.
 * @param {{ bounds: Box3, density?: number, steps?: number, scale?: number, blur?: number, scattering?: (tsl: any, at: { positionRay: any, density: any }) => any, order?: number, enabled?: boolean, name?: string }} o
 *   bounds: the box of air, required (the march covers it, so keep it tight); density: how thick the air is; scale: fraction of the screen size the air is drawn at; scattering: density per point, for smoke or ground fog
 *   (it gets the world position of the sample and the density uniform).
 * @returns {PostEffect}
 */
export function lightVolumes({ bounds, density = 0.3, steps = 16, scale = 0.25, blur = 4, scattering, order = 200, enabled, name = 'lightVolumes' } = /** @type {any} */ ({})) {
  if (!bounds?.isBox3) throw codedError('post-effect', 'lightVolumes: bounds is required, the box of air to light: lightVolumes({ bounds: new THREE.Box3(min, max) })');
  return { name, slot: 'hdr', order, enabled, params: { density },
    node(input, { tsl, p, scene, camera, scenePass, display }) {
      const size = bounds.getSize(new Vector3()), mat = new VolumeNodeMaterial();
      mat.steps = steps;
      mat.offsetNode = bayer16(tsl.screenCoordinate);
      mat.scatteringNode = ({ positionRay }) => (scattering ? scattering(tsl, { positionRay, density: p.density }) : p.density);
      mat.depthNode = scenePass.getTextureNode('depth').sample(tsl.screenUV);
      const box = new Mesh(new BoxGeometry(size.x, size.y, size.z), mat);
      bounds.getCenter(box.position);
      box.receiveShadow = true;
      box.layers.set(VOLUME_LAYER);   // not on the view camera: only the small pass below draws it, and voxel GI or probes never take it for geometry
      scene.add(box);
      const layers = new Layers(); layers.set(VOLUME_LAYER);
      const air = display.pass(scene, camera, { depthBuffer: false, samples: 0 });
      air.setLayers(layers); air.setResolutionScale(scale);
      // a pass clears to the scene's background and the renderer's clear color; this one is added over the picture, so it must start from nothing
      const draw = air.updateBefore;
      const lamps = new Set();
      let look = 0;
      air.updateBefore = frame => {
        // three lights a pass only with the lights on its layers; a new lamp is found within half a second
        if (look-- <= 0) { look = 30; scene.traverse(l => { if ((l.isPointLight || l.isSpotLight) && !l.layers.isEnabled(VOLUME_LAYER)) { l.layers.enable(VOLUME_LAYER); lamps.add(l); } }); }
        const r = frame.renderer, { background, backgroundNode } = scene, clear = r.getClearColor(new Color()), alpha = r.getClearAlpha();
        // three prefers backgroundNode over background, so both go
        scene.background = scene.backgroundNode = null; r.setClearColor(0x000000, 0);
        try { draw.call(air, frame); } finally { scene.background = background; scene.backgroundNode = backgroundNode; r.setClearColor(clear, alpha); }
      };
      display.own({ dispose() { for (const l of lamps) l.layers.disable(VOLUME_LAYER); box.removeFromParent(); box.geometry.dispose(); mat.dispose(); } });
      return tsl.vec4(input.rgb.add(display.own(gaussianBlur(air.getTextureNode(), blur)).rgb), input.a);
    },
    facts: () => ({ lights: 'point and spot only; the sun does nothing here (sunShafts)' }) };
}
