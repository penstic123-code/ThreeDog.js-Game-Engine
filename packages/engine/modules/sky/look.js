// Sky look setup (helper of Sky.js): which engine lights the sky drives, the fog model, extra dome layers.
// Light modes, sky() options only (whether the engine's two lights exist is how the game lights its world, not a swappable look):
//   sky({ sun: true })        default: the sky drives engine.lights.sun (color, intensity, direction, shadow box) from the keyframes
//   sky({ sun: false })       hidden (visible = false, no shadows) and never touched: light the world with your own three.js lights
//   sky({ hemisphere: true | false })   the same for engine.lights.hemi (ambient)
//   sky({ fog: true | false })   scene.fog: true (default) the sky creates it and writes color and distance every frame | false scene.fog = null
//                                and never touched. An object here is style.sky.fog settings (= true)
// Keeping a light / the fog but writing it yourself is not a sky() option: one takeover entry per look value (2026-11-02), engine.look.lights.manual(
// 'sun' | 'hemi' | 'sun.intensity' ...) and engine.look.fog.manual() (core/owned.js). manual(key, false) hands it back, and a direct write without
// either takes it too (the sky yields and warns once). The removed 'manual' mode throws and names that call, so old code learns the one way.
// Hidden lights are left in the scene (visible = false): three skips them, and toggling visible later recompiles like adding a light would.
import * as THREE from 'three';
import { resolveFog, DOME_FOG } from './fog.js';
import { resolveDomeLayers } from './domeLayers.js';
import { codedError } from '../../core/errorHints.js';

const TAKE = { sun: "engine.look.lights.manual(['sun.intensity', 'sun.color'])", hemisphere: "engine.look.lights.manual('hemi')", fog: 'engine.look.fog.manual()' };
const modeOf = (name, v = true) => {
  if (v === 'manual') throw codedError('sky-option', `sky({ ${name}: 'manual' }) is not an option; keep the default and take it over after engine.use(sky()) with ${TAKE[name]} (manual(..., false) hands it back)`);
  if (v !== true && v !== false) throw codedError('sky-option', `sky({ ${name} }) must be true (the sky drives it) or false (${name === 'fog' ? 'no fog' : 'hidden, light the world yourself'}); to write it yourself: ${TAKE[name]}; got ${JSON.stringify(v)}`);
  return v;
};

/** Resolve light modes, fog and dome layers for a new Sky; returns the extra dome uniforms and GLSL ({ uniforms, decl, body }) */
export function prepareLook(sky, st, over) {
  /** @internal which engine lights / fog the sky writes each frame: true / false */
  // fog is also the look override (an object of style.sky.fog settings, which means true); a boolean picks the mode and keeps the style's settings
  const fogObj = over.fog != null && typeof over.fog === 'object';
  sky._drive = { sun: modeOf('sun', over.sun), hemi: modeOf('hemisphere', over.hemisphere), fog: fogObj ? true : modeOf('fog', over.fog) };
  const { sun, hemi } = sky.engine.lights;
  if (sky._drive.sun === false) { sun.visible = false; sun.castShadow = false; }
  if (sky._drive.hemi === false) hemi.visible = false;
  /** @internal resolved fog settings (fog.js) */
  sky._fogSpec = fogObj || over.fog == null ? st.fog : sky.engine.style.sky?.fog;   // look.fog's style layer (lookFog.js)
  sky._fog = resolveFog(sky._fogSpec);
  sky._backdrop = resolveBackdrop(st);
  const f = DOME_FOG, l = resolveDomeLayers(st.layers);
  // the fog object is created after the dome and may be replaced by the game: read its color at draw time (fog.js fogBand turns the band on)
  const uniforms = { ...l.uniforms, uFogBand: { value: 0 }, uFogColor: { get value() { return sky.engine.scene.fog?.color ?? sky.uniforms.uHorizon.value; } } };
  return { uniforms, decl: [f.decl, l.decl].filter(Boolean).join('\n'), body: f.body + l.body };
}

// style.sky.backdrop: one flat color (or ({ time, weather, season, state, sky }) => color each frame, core/look/state.js) instead of the dome -- no gradient, horizon, sun / moon disk,
// stars or clouds. The color goes straight to scene.background (no tone mapping), so what is written is what shows; the keyframes
// still light the world, and fog in its default 'horizon' color follows the backdrop so far things fade into it.
export function resolveBackdrop(st) {
  const v = st.backdrop;
  if (v == null) return null;
  const color = typeof v === 'number' || typeof v === 'string' || v.isColor;
  if (!color && typeof v !== 'function') throw codedError('sky-option', `style.sky.backdrop must be a color (0xefebe4, '#efebe4') or ({ time, state }) => color; got ${JSON.stringify(v)}`);
  if (st.skybox) throw codedError('sky-option', 'style.sky: backdrop and skybox both replace the dome; keep one (backdrop for a flat color, skybox for a panorama)');
  return { fn: color ? null : v, color: new THREE.Color(color ? v : 0x000000) };
}
