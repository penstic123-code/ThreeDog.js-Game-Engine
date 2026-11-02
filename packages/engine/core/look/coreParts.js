// look.tone, lights, clouds.
// look.tone = renderer exposure (the curve is written once at creation, then plain three.js), look.lights = the engine's placeholder sun + hemisphere, look.cloudShadow = the cloud-shadow patch.
// Why here and not in sceneMethods: the 0.2 renames (recipe 52) now write the 'game' layer, and the style values
// are the 'style' layer, so describe().look / describe().render can say who set a value instead of guessing from start values.
import * as THREE from 'three';
import { defineLookPart } from './part.js';
import { defineOwned } from '../owned.js';
import { warnOnce } from '../validate.js';
import { codedError } from '../errorHints.js';

const ONCE = 'The engine writes toneMapping once, at createEngine (style.toneMapping, else AgX), and never again, so your write stays';

const NO_DRIVER = "look.lights {k}: a function value is evaluated every frame by a time-of-day module; nothing drives {k} now (no sky, sky({ sun / hemisphere: false }), or look.lights.manual(...)), so it is ignored. Install sky(), or set a number / color";
import { setRoomEnvironment } from '../../render/lights.js';

/** style.toneMapping names -> three constants */
export const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, none: THREE.NoToneMapping };
/** three's toneMapping constant -> the style name ('agx'), or the number as text for one outside TONE (CustomToneMapping...) */
export const toneName = v => Object.keys(TONE).find(k => TONE[k] === v) ?? String(v);

/**
 * The curve written once at creation: the style's toneMapping name, else AgX for the baseline (none without it).
 * AgX over ACES for the baseline: it rolls bright values off to white without ACES's hue shifts (saturated colors drifting to yellow / cyan)
 * and extra contrast, so whatever colors a game adds later keep their hue; a style picks its own curve
 */
function toneMappingOf(name, baseline) {
  if (name == null) return baseline ? THREE.AgXToneMapping : THREE.NoToneMapping;
  if (!(name in TONE)) throw codedError('style-value', `style.toneMapping must be one of ${Object.keys(TONE).map(k => `"${k}"`).join(', ')}; got ${JSON.stringify(name)}. ` +
    'Any other three curve: engine.renderer.toneMapping = THREE.<Name>ToneMapping after createEngine');
  return TONE[name];
}

/**
 * Exposure over the day: [[time 0-1, exposure], ...] sorted by time, wrapping across midnight (after the last row it blends back to the first),
 * or ({ time, weather, season, state, sky }) => number (core/look/state.js). Returns the per-frame function of that context, null for a plain number (set once); throws on anything else
 */
export function exposureDriver(v) {
  if (typeof v === 'number') return null;
  if (typeof v === 'function') return v;
  const ok = Array.isArray(v) && v.length > 0 && v.every((k, i) => Array.isArray(k) && typeof k[0] === 'number' && typeof k[1] === 'number' && k[0] >= 0 && k[0] <= 1 && (i === 0 || k[0] > v[i - 1][0]));
  if (!ok) throw codedError('style-value', `exposure must be a number, [[time 0-1, exposure], ...] sorted by time (e.g. [[0, 1.6], [0.5, 1], [0.8, 1.3]]) or ({ time, state }) => number; got ${JSON.stringify(v)}`);
  return ctx => {
    const t = ctx.time, n = v.length;
    let i = -1; for (let k = 0; k < n; k++) if (v[k][0] <= t) i = k;
    const a = v[i < 0 ? n - 1 : i], b = v[(i + 1) % n];   // before the first row or after the last: the segment across midnight
    const span = (b[0] - a[0] + 1) % 1 || 1, f = ((t - a[0] + 1) % 1) / span;
    return a[1] + (b[1] - a[1]) * f;
  };
}
const badExposure = v => { try { exposureDriver(v); return null; } catch (err) { return err.message; } };

/**
 * Write the tone curve once and register look.tone and look.lights. owned: false when the game passed its own renderer: then neither the style's
 * curve nor its exposure is applied at start (the renderer is the game's), but a later look.tone.set({ exposure }) still writes exposure.
 * baseline: the engine's own renderer, under every style (user decision 2026-11-02). The engine defaults are then a technical render baseline
 * instead of "off": AgX tone mapping, soft sun shadows, a neutral generated environment, a dimmer hemisphere (the environment adds ambient too).
 * Not art: a pack still picks every color, and one that wants none of it says so (style.toneMapping: 'none', look.lights sun.shadow false / env.intensity 0).
 * Why under every pack: a pack that never mentioned tone mapping or an environment rendered flatter than a plain, well-set-up three.js scene.
 * @param {any} e @param {{ owned: boolean, baseline?: boolean }} o
 */
export function defineCoreLook(e, { owned, baseline = false }) {
  const r = e.renderer;
  const B = 'technical render baseline under every style (not art), so plain three.js materials look as they would in a well-set-up three.js scene';
  // Tone mapping is not a look param (user decision 2026-11-03, plan 2026-11-02 section 3): it is a render baseline the engine writes once here,
  // at creation, and never again. A game changes it with plain three.js (engine.renderer.toneMapping = THREE.ACESFilmicToneMapping) and nothing
  // overwrites it, because no engine code writes toneMapping after this line; a wrapper param would be a second road to the same property.
  if (owned) r.toneMapping = toneMappingOf(e.style.toneMapping, baseline);
  defineLookPart(e, {
    id: 'tone', group: 'atmosphere', module: 'core', object: () => e.renderer, applyAtStart: owned, docs: ['recipes/52-look.md'],
    params: {
      exposure: { type: 'any', default: 1, neutral: true, fn: true, cost: 'uniform', check: badExposure, desc: 'a number, day keyframes [[time 0-1, exposure], ...] or ({ time, weather, season, state, sky }) => number (a time-of-day module evaluates it each frame)' },
    },
    // the old curve key gets the plain three.js line instead of a bare "unknown key" (normalize runs before the key check, write.js)
    normalize: p => { if (p && 'mapping' in p) throw codedError('look-param', `look.tone.set(): there is no mapping key; the curve is plain three.js: engine.renderer.toneMapping = THREE.AgXToneMapping (or ACESFilmic / Neutral / No / Custom). ${ONCE}`); return p; },
    style: () => (owned ? { exposure: e.style.exposure } : {}),
    read: () => ({ exposure: e.exposureDriver ? undefined : r.toneMappingExposure }),
    apply(v, changed) {
      if (changed.has('exposure')) {
        // keyframes / a function become exposureDriver, which a time-of-day module (sky) evaluates each frame; core knows no time of day
        e.exposureDriver = exposureDriver(v.exposure);
        if (typeof v.exposure === 'number') r.toneMappingExposure = v.exposure;
      }
    },
    // plain three.js always works: the curve itself is three's renderer.toneMapping, so the error shows that instead of saying it is impossible
    noPatch: "look.tone has no GLSL hook and no curve param; the curve is plain three.js: engine.renderer.toneMapping = THREE.ACESFilmicToneMapping, or " +
      "THREE.CustomToneMapping and replace the CustomToneMapping function in THREE.ShaderChunk.tonemapping_pars_fragment (before the first render). The engine never writes toneMapping after createEngine",
    noReplace: 'to own tone mapping completely, set engine.renderer.toneMapping yourself (the engine writes it only once, at creation) ' +
      'or pass your own renderer: createEngine({ renderer }) (recipes/50)',
  });

  const { sun, hemi } = e.lights, scene = e.scene;
  const off = "look.lights.set({ sun: { intensity: 0 } }) (or hemi), or createEngine({ lights: false }) and light the world with your own three.js lights";
  const why = 'placeholder light so a scene without a sky module (and the gray placeholders) is never black; an installed sky drives it from style.sky.keyframes instead';
  defineLookPart(e, {
    id: 'lights', group: 'atmosphere', module: 'core', object: () => e.lights, docs: ['recipes/52-look.md'],
    params: {
      'sun.intensity': { type: 'number', default: 2, min: 0, fn: true, cost: 'uniform', why, off },
      'sun.color': { type: 'any', default: '#ffffff', fn: true, neutral: true, cost: 'uniform', desc: 'any THREE.Color input' },
      'hemi.intensity': { type: 'number', default: baseline ? 0.6 : 1.2, min: 0, fn: true, cost: 'uniform', why, off },
      'hemi.color': { type: 'any', default: '#ffffff', fn: true, neutral: true, cost: 'uniform', desc: 'sky color of the hemisphere light' },
      'hemi.ground': { type: 'any', default: '#555555', fn: true, cost: 'uniform', why: 'darker ground color, so faces turned down read darker than faces turned up', off: "look.lights.set({ hemi: { ground: '#ffffff' } })" },
      // on (true / 0.5) for the baseline (the engine's own renderer, any style); off (false / 0) only when the game passed its own renderer
      'sun.shadow': { type: 'bool', default: baseline, cost: 'recompile', desc: 'the engine sun casts soft shadows (2048 map, 60 m box following engine.focus without a sky module); also needs createEngine({ shadows }) on',
        why: B, off: 'look.lights.set({ sun: { shadow: false } }) or createEngine({ shadows: false })' },
      // two keys, one meaning each (render/lights.js refreshRoom): env.intensity is always the absolute scene.environmentIntensity, env.share
      // only the sky's budget split. One key that changed meaning when a sky was installed made a game's 0.7 silently read as "70% of the ambient"
      'env.intensity': { type: 'number', default: baseline ? 0.5 : 0, min: 0, cost: 'uniform',
        desc: "neutral room environment (three's RoomEnvironment through PMREM, generated, no asset) as scene.environment, at this scene.environmentIntensity; 0 = none. Only written while scene.environment is empty or this map: your own scene.environment, or a sky's look.env, wins. Under a sky env.share applies instead, unless a game or style wrote env.intensity: then this value is written as it is (no time-of-day follow; the hemisphere light keeps the whole ambient budget)",
        why: B + '; PBR (Standard / Physical) materials need an environment to reflect, or metals render black', off: 'look.lights.set({ env: { intensity: 0 } })' },
      'env.share': { type: 'number', default: baseline ? 0.5 : 0, min: 0, max: 1, cost: 'uniform',
        desc: "under a sky only: the room map's share (0..1) of the style's ambient budget, following the time of day; the hemisphere light gets the rest (one diffuse budget, not a fill on top). 0 = no room map under the sky. Not read without a sky (env.intensity is) or once a game wrote env.intensity (describe().look.env.source.mode)",
        why: B + '; under a sky the PBR environment is part of the ambient light of the day, so it dims at night', off: 'look.lights.set({ env: { share: 0 } })' },
    },
    read: () => ({ 'sun.intensity': sun.intensity, 'hemi.intensity': hemi.intensity }),
    apply(v, changed) {
      // undefined = a style driver (sky) writes this key every frame: leave it to the driver
      // a function value (({ time, state }) => ...) is evaluated by the sky each frame (applyTop with the frame context); without a sky nothing calls it
      const set = (k, fn) => { if (!changed.has(k) || v[k] === undefined) return; if (typeof v[k] === 'function') { if (!e.look.lights.driven(k)) warnOnce(NO_DRIVER.replace('{k}', k)); return; } fn(v[k]); };
      set('sun.intensity', x => { sun.intensity = x; });
      set('sun.color', x => sun.color.set(x));
      set('hemi.intensity', x => { hemi.intensity = x; });
      set('hemi.color', x => hemi.color.set(x));
      set('hemi.ground', x => hemi.groundColor.set(x));
      set('sun.shadow', x => { sun.castShadow = x && e.shadows !== false; });
      if (changed.has('env.intensity') || changed.has('env.share')) {
        // absolute: a game / style / debug layer wrote env.intensity (the engine's own default does not count), so under a sky the engine yields to it
        const src = e.look?.lights?._source('env.intensity');
        // the game's or the sky's map is never overwritten, and the map is built only once a material reads it (render/lights.js refreshRoom)
        setRoomEnvironment(e, { base: v['env.intensity'], share: v['env.share'], absolute: !!src && src.layer !== 'engine' });
      }
    },
    noPatch: 'lights have no shader of their own; how surfaces take light is look.surface (lighting / ramp)',
    noReplace: "to light the world yourself, turn the engine lights off: createEngine({ lights: false }), or sky({ sun: false }); to write the engine sun yourself: engine.look.lights.manual('sun')",
  });
}

/**
 * look.view: the camera and the drawing buffer as the engine touches them on its own. No params: the only verb is manual(), which takes
 * camera.far (raised by fog distance / terrain view range), the pixel ratio (adaptive resolution) or the camera pose (a camera module) for the game.
 * Why a part with nothing to set: these writes need a home for manual() and describe().owned.
 * @param {any} e
 */
/**
 * Every engine write of camera.fov (settings menu slider, camera modules) goes through here: it yields to a fov the game set itself (owned 'camera.fov').
 * @param {any} e @param {number} v
 */
export function setFov(e, v) { e._setFov(v); }

export function defineViewLook(e) {
  defineLookPart(e, {
    id: 'view', group: 'screen', module: 'core', object: () => e.camera, docs: ['recipes/52-look.md'],
    noPatch: 'the view has no shader; for your own camera use engine.takeCamera(owner)',
    noReplace: "to place the camera yourself use const cam = engine.takeCamera('me') (cam.remove() gives it back); " +
      "to stop the engine changing camera.far, camera.fov or the pixel ratio: engine.look.view.manual('far' | 'fov' | 'pixelRatio')",
  });
  const cam = () => e.camera;
  e._oFar = defineOwned(e, { id: 'camera.far', part: 'view', key: 'far', read: () => cam().far, objects: [e.camera],
    write: v => { cam().far = v; cam().updateProjectionMatrix(); }, levels: { manual: "engine.look.view.manual('far')" } });
  e._oPixelRatio = defineOwned(e, { id: 'pixelRatio', part: 'view', key: 'pixelRatio', read: () => e.renderer.getPixelRatio(), objects: [e.renderer],
    levels: { manual: "engine.look.view.manual('pixelRatio')", set: 'engine.setPixelRatio(1.5)' } });
  // fov: the settings menu slider and camera modules (first person / rts / fixed shots, and restoring the fov at uninstall) write it.
  // They all go through e._setFov, so a game that sets camera.fov itself (a zoom, a cutscene) is not undone by the next camera switch.
  e._oFov = defineOwned(e, { id: 'camera.fov', part: 'view', key: 'fov', read: () => cam().fov, objects: [e.camera],
    write: v => { if (cam().fov !== v) { cam().fov = v; cam().updateProjectionMatrix(); } }, levels: { manual: "engine.look.view.manual('fov')" } });
  /** @internal every engine write of camera.fov (settings menu, camera modules): yields to the game's own value */
  e._setFov = (/** @type {number} */ v) => e._oFov.drive(v);
  e._oFar.mark(); e._oPixelRatio.mark(); e._oFov.mark();
}

/**
 * look.cloudShadow: drifting cloud shadows on the ground and on every material from makeMaterial / applyEffects. The patch is on by default (clouds: true)
 * so the style and the weather can darken it later without a recompile; how dark comes from style.clouds.shadow, 0 (nothing drawn) without one.
 * Declared as a part so this default is visible in describe().look and the catalog instead of hiding in applyEffects.
 * @param {any} e
 */
export function defineCloudShadowLook(e) {
  const u = e.uniforms, c = e.style.clouds ?? {};
  defineLookPart(e, {
    id: 'cloudShadow', group: 'surface', module: 'core', object: () => u, docs: ['recipes/52-look.md'],
    params: {
      shadow: { type: 'number', default: 0, min: 0, max: 1, cost: 'uniform', desc: 'darkest cloud shadow (uCloudShadow)',
        why: 'every engine material carries the cloud-shadow patch (applyEffects clouds: true) so a style or the weather can darken it with no recompile; at 0 it draws nothing',
        off: 'look.cloudShadow.set({ shadow: 0 }); to leave the patch out of one material: applyEffects(mat, { clouds: false })' },
      scale: { type: 'number', default: 0.006, min: 0, neutral: true, cost: 'uniform', desc: 'cloud size (smaller = bigger clouds)' },
      speed: { type: 'array', default: [0.012, 0.006], neutral: true, cost: 'uniform', desc: 'drift [x, z] per second' },
    },
    style: () => ({ shadow: c.shadow, scale: c.scale, speed: c.speed }),
    read: () => ({ shadow: u.uCloudShadow.value, scale: u.uCloudScale.value }),
    apply(v, changed) {
      if (changed.has('shadow')) u.uCloudShadow.value = v.shadow;
      if (changed.has('scale')) u.uCloudScale.value = v.scale;
      if (changed.has('speed')) u.uCloudSpeed.value.set(v.speed[0], v.speed[1]);
    },
    noPatch: 'the cloud-shadow GLSL is shared with the sky clouds; change the look with look.cloudShadow.set({ shadow, scale, speed })',
    noReplace: 'to drop cloud shadows from a material, build it with applyEffects(mat, { clouds: false })',
  });
}