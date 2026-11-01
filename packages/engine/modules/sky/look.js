// Sky look setup (helper of Sky.js): which engine lights the sky drives, the fog model, extra dome layers.
// Light modes, sky() options only (whether the engine's two lights exist is how the game lights its world, not a swappable look):
//   sky({ sun: true })        default: the sky drives engine.lights.sun (color, intensity, direction, shadow box) from the keyframes
//   sky({ sun: 'manual' })    the sky still aims it along the time of day and moves the shadow box; color and intensity are the game's
//   sky({ sun: false })       hidden (visible = false, no shadows) and never touched: light the world with your own three.js lights
//   sky({ hemisphere: true | 'manual' | false })   the same for engine.lights.hemi (ambient): 'manual' leaves its colors and intensity alone
//   sky({ fog: true | 'manual' | false })   scene.fog: true (default) the sky creates it and writes color and distance every frame |
//                                           'manual' created once, then never written (the game sets color / near / far / its own object) |
//                                           false scene.fog = null and never touched. An object here is style.sky.fog settings (= true)
// Hidden lights are left in the scene (visible = false): three skips them, and toggling visible later recompiles like adding a light would.
import * as THREE from 'three';
import { resolveFog, domeFog } from './fog.js';
import { resolveDomeLayers } from './domeLayers.js';

const MODES = [true, false, 'manual'];
const modeOf = (name, v = true) => {
  if (!MODES.includes(v)) throw new Error(`sky({ ${name} }) must be true (the sky drives it), 'manual' (the game sets its color and intensity) or false (hidden, light the world yourself); got ${JSON.stringify(v)}`);
  return v;
};

/** Resolve light modes, fog and dome layers for a new Sky; returns the extra dome uniforms and GLSL ({ uniforms, decl, body }) */
export function prepareLook(sky, st, over) {
  /** @internal which engine lights the sky writes each frame: true / 'manual' / false */
  // fog is also the look override (an object of style.sky.fog settings, which means true); a boolean or 'manual' picks the mode and keeps the style's settings
  const fogObj = over.fog != null && typeof over.fog === 'object';
  sky._drive = { sun: modeOf('sun', over.sun), hemi: modeOf('hemisphere', over.hemisphere), fog: fogObj ? true : modeOf('fog', over.fog) };
  const { sun, hemi } = sky.engine.lights;
  if (sky._drive.sun === false) { sun.visible = false; sun.castShadow = false; }
  if (sky._drive.hemi === false) hemi.visible = false;
  /** @internal resolved fog settings (fog.js) */
  sky._fogSpec = fogObj || over.fog == null ? st.fog : sky.engine.style.sky?.fog;   // look.fog's style layer (lookFog.js)
  sky._fog = resolveFog(sky._fogSpec);
  sky._backdrop = resolveBackdrop(st);
  const f = domeFog(sky._fog), l = resolveDomeLayers(st.layers);
  const uniforms = { ...l.uniforms };
  // the fog object is created after the dome, and its color is rewritten each frame: read it at draw time
  if (f.decl) uniforms.uFogColor = { get value() { return sky.engine.scene.fog?.color ?? sky.uniforms.uHorizon.value; } };   // no fog object (fog: false): fade to the horizon
  return { uniforms, decl: [f.decl, l.decl].filter(Boolean).join('\n'), body: f.body + l.body };
}

// style.sky.backdrop: one flat color (or (sky) => color each frame) instead of the dome -- no gradient, horizon, sun / moon disk,
// stars or clouds. The color goes straight to scene.background (no tone mapping), so what is written is what shows; the keyframes
// still light the world, and fog in its default 'horizon' color follows the backdrop so far things fade into it.
export function resolveBackdrop(st) {
  const v = st.backdrop;
  if (v == null) return null;
  const color = typeof v === 'number' || typeof v === 'string' || v.isColor;
  if (!color && typeof v !== 'function') throw new Error(`style.sky.backdrop must be a color (0xefebe4, '#efebe4') or (sky) => color; got ${JSON.stringify(v)}`);
  if (st.skybox) throw new Error('style.sky: backdrop and skybox both replace the dome; keep one (backdrop for a flat color, skybox for a panorama)');
  return { fn: color ? null : v, color: new THREE.Color(color ? v : 0x000000) };
}
