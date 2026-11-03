// Default lights every engine has (engine.lights, the mechanism): a directional "sun" + hemisphere ambient, plain white / neutral gray.
// With no style they form the technical baseline (look.lights: soft sun shadows that follow engine.focus, a generated neutral room
// environment for PBR; look.tone: AgX). They are not a tuned look: sun color and intensity curves,
// sky colors, fog, shadows and exposure come from the style through the sky module, which drives these same two lights instead of
// adding its own. A game that wants different lighting edits or hides them (engine.lights.sun.visible = false) and adds its own three.js lights,
// before engine.start(): a light count that changes during play recompiles shaders (recipes/09 "Lights and stalls", lightPool() for many lights).
import { engineOwned } from '../core/things.js';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { defineOwned, markOwned } from '../core/owned.js';
import { sceneVisitor } from '../core/sceneDelta.js';
import { isWebGPU, webgpuPart, compileThrough } from './backend.js';

const BOX = 30, OFFSET = new THREE.Vector3(40, 80, 30), SNAP = 0.5;

/** @param {any} engine @returns {{ sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight }} */
export function createDefaultLights(engine, { add = true } = {}) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(40, 80, 30);   // above and to the side, so faces read with some shading
  sun.castShadow = true;          // the engine's light casts; whether anything draws shadows is look.shadow enabled (core/look/shadowPart.js)
  // baseline shadow box: 2048 map over 60 m around engine.focus (~3 cm texels), PCF with a small blur radius = soft edges; bias / normalBias keep
  // acne off flat ground and slopes without visible peter-panning at this texel size. bias is in the shadow camera's 0-1 depth (near 1 - far 250 m):
  // -0.0001 = 2.5 cm; the old -0.0005 was 12 cm and cut the shadow at the base of things standing on the ground
  const sc = sun.shadow.camera;
  sun.shadow.mapSize.set(2048, 2048);
  sc.left = sc.bottom = -BOX; sc.right = sc.top = BOX; sc.near = 1; sc.far = 250; sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0001; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  // add: false (createEngine({ lights: false })): the objects still exist so engine.lights.sun / hemi and the sky module never hit undefined, but they
  // are not in the scene, so nothing is lit by them and they cost no shader light slots; the game brings all its own lights
  engineOwned('lights', hemi, sun, sun.target);   // the module's, not the game's, when the scene adopts what is added (core/things.js)
  if (add) engine.scene.add(hemi, sun, sun.target);
  return { sun, hemi };
}

/**
 * Baseline sun follow (no sky module): keep the shadow box around engine.focus, snapped to SNAP m so it only moves in steps (no shimmer while still).
 * An installed sky moves the sun itself (modules/sky/shadow.js). Called before the main render.
 * @param {any} e
 */
export function followFocus(e) {
  const sun = e.lights?.sun;
  if (!sun?.castShadow || !sun.parent) return;
  // 'shadow.follow' is one row in describe().owned: a module that moves the sun itself (a sky) defines it while installed, and then this
  // baseline steps aside. Asking who holds the row, not whether e.sky exists, keeps render/ free of module names and lets a game's own sun
  // driver take over the same way. A game that places sun.target itself keeps it (manual level).
  const held = e._owned?.get('shadow.follow');
  if (held && held !== e._oBaseFollow) return;
  // without a sky there is no look.shadow part, so the takeover lives on look.lights. Registered again whenever it is not the current one (a sky came and went)
  const o = held && held === e._oBaseFollow ? e._oBaseFollow : (e._oBaseFollow = defineOwned(e, {
    id: 'shadow.follow', part: 'lights', key: 'shadow.follow', read: () => sun.target.position.toArray(), objects: [sun.target, sun.target.position],
    levels: { manual: "engine.look.lights.manual('shadow.follow')" } }));
  if (!o._snap) o.mark();
  o.check();
  if (!o.on) return;
  const f = e.focus, x = Math.round(f.x / SNAP) * SNAP, z = Math.round(f.z / SNAP) * SNAP;
  if (sun.target.position.x === x && sun.target.position.z === z) return;
  sun.target.position.set(x, 0, z); sun.position.set(x + OFFSET.x, OFFSET.y, z + OFFSET.z);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  o.mark();
}

// The room map has two look.lights keys, one meaning each (they used to be one key whose meaning changed silently when a sky was installed):
//   env.intensity  the absolute scene.environmentIntensity of the room map (no sky, or a game / style that wrote it under a sky)
//   env.share      under a sky only: the room map's share (0..1) of the style's ambient budget; the hemisphere light gets the rest (roomShare)
// Under a sky the share applies unless a game or style layer wrote env.intensity: then the engine yields and writes that value as it is (no
// time-of-day follow, the hemisphere light carries the whole budget). e._roomBase / _roomShare / _roomAbs hold the keys, e._roomScale the sky's scale.
const shareMode = e => e._roomScale != null && !e._roomAbs;
/** environmentIntensity the room map gets now @param {any} e */
const roomLevel = e => (shareMode(e) ? (e._roomShare ?? 0) * e._roomScale : (e._roomBase ?? 0));
/** @param {any} e */
const roomWanted = e => (shareMode(e) ? (e._roomShare ?? 0) > 0 : (e._roomBase ?? 0) > 0);

/**
 * look.lights wrote env.intensity / env.share (absolute: env.intensity came from a game or style layer, not the engine default). Then refreshRoom.
 * @param {any} e @param {{ base?: number, share?: number, absolute?: boolean }} o
 */
export function setRoomEnvironment(e, { base, share, absolute }) {
  if (base !== undefined) e._roomBase = base;
  if (share !== undefined) e._roomShare = share;
  if (absolute !== undefined) e._roomAbs = absolute;
  refreshRoom(e);
}

/**
 * Put the room map on or off at its level (roomLevel). Never overwrites someone else's scene.environment (the game's, or a sky's map).
 * Built already: set at once. Not built yet: only remembered (_roomWant), and syncRoomEnvironment builds it when some material in the scene
 * reads scene.environment. Why lazy: the PMREM prefilter costs ~0.6 s on a cold start (shader compiles), and a scene of Toon / Basic / Matcap /
 * shader materials never samples it, so it used to be paid at createEngine for nothing.
 * @param {any} e
 */
export function refreshRoom(e) {
  const s = e.scene, ours = e._roomEnv?.texture;
  if (s.environment && s.environment !== ours) { e._roomWant = 0; return; }
  if (!roomWanted(e)) { e._roomWant = 0; if (ours && s.environment === ours) s.environment = null; return; }
  if (e._roomEnv) { s.environment = ours; s.environmentIntensity = roomLevel(e); e._roomWant = 0; markOwned(e, 'env'); return; }
  e._roomWant = 1;
}

/**
 * The sky's scale of the room environment (null = none: no sky): in share mode environmentIntensity = env.share x scale, where scale is the
 * style's ambient now in environment units (sky/frame.js). Why: the room map is a fixed, evenly lit studio; under a sky it is part of the
 * ambient light of the day, so it dims with the sky's light or every PBR surface stays day-lit at night (demo finding 2026-11-02).
 * Writes scene.environmentIntensity only while the room map is the current environment; the caller (the sky) checks / marks its owned 'env' row.
 * write false: only remember the scale (the game owns scene.environmentIntensity now).
 * @param {any} e @param {number | null} scale @param {boolean} [write]
 */
export function followRoomEnvironment(e, scale, write = true) {
  const was = shareMode(e);
  e._roomScale = scale;
  // a sky came or went: the other key decides whether the map is on (also while it is not built yet: whether it is still wanted)
  if (was !== shareMode(e) && (write || !isRoomEnvironment(e))) refreshRoom(e);
  else if (write && isRoomEnvironment(e)) e.scene.environmentIntensity = roomLevel(e);
}

/** Whether scene.environment is the engine's room map now @param {any} e */
export const isRoomEnvironment = e => !!e._roomEnv && e.scene.environment === e._roomEnv.texture;

// How much diffuse light the room map gives at environmentIntensity 1: the mean linear luminance of a white Lambert / Standard sphere lit by
// it alone (no tone mapping), averaged over six views (top 1.44, bottom 0.68, sides 0.76-1.07; three 0.187 RoomEnvironment, PMREM sigma 0.04).
// A fact about three's room map, not a look value: it converts the style's ambient (hemisphere units) into an environment intensity, so the
// room map and the hemisphere light can share one ambient budget (roomShare) instead of the map adding several times the ambient on top.
// Guarded by the 'room radiance' test, which measures it again: a three.js upgrade that changes RoomEnvironment fails there, not in the picture
export const ROOM_RADIANCE = 1.05;

/**
 * Under a sky the style's ambient column is the whole diffuse fill. The room map takes this share of it (look.lights env.share, 0..1) and
 * the hemisphere light the rest; 0 while the room map is not the current environment (not built yet, a sky / game map, none) or a game wrote
 * env.intensity (an absolute fill on top: the engine yields), so the hemisphere light then carries all of it. Why: with the map on top, a
 * rainy-street noon got about four times the style's ambient, shadows were 19% darker than lit ground instead of 56%, and turning the sun off
 * changed the picture by 0.08 (R4 measure)
 * @param {any} e
 */
export const roomShare = e => (isRoomEnvironment(e) && shareMode(e) ? Math.min(1, e._roomShare ?? 0) : 0);

/** The room map's keys and mode, and whether it waits for a material that reads it (describe) @param {any} e */
export const roomEnvironmentInfo = e => ({ base: e._roomBase ?? 0, share: e._roomShare ?? 0, mode: shareMode(e) ? 'share' : 'absolute', pending: !!e._roomWant });

/** Forget a pending room environment (dispose) @param {any} e */
export function dropRoomEnvironment(e) { e._roomWant = 0; }

/**
 * Which materials sample scene.environment, read from three 0.187 (WebGLPrograms.getParameters / WebGLRenderer.setProgram): Standard and
 * Physical (isMeshStandardMaterial), Lambert and Phong, each only while it has no envMap of its own. Toon, Basic, Matcap, Normal, Depth,
 * Shader / RawShader and points / lines never do.
 * @param {any} m
 */
const readsEnv = m => !!m && !m.envMap && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);

/**
 * Whether the pending room environment is wanted now: a material that reads it is in the scene. While it is pending, only objects that
 * entered the scene since the last frame are looked at (core/sceneDelta.js: an add at any depth, or mesh.material = x), so a quiet frame
 * costs one size check. A game or sky map set meanwhile wins: the pending request is dropped (the same "never overwrite someone else's
 * scene.environment" rule refreshRoom follows).
 * @param {any} e
 */
function roomNeeded(e) {
  const s = e.scene;
  if (e._roomWant && s.environment) e._roomWant = 0;
  if (!e._roomWant) { e._roomView?.remove(); e._roomView = null; return false; }
  e._roomView ??= sceneVisitor(s, { enter(o) { if (o.material && !e._roomHit) e._roomHit = Array.isArray(o.material) ? o.material.some(readsEnv) : readsEnv(o.material); } });
  e._roomView.sync();
  if (!e._roomHit) return false;
  e._roomView.remove(); e._roomView = null; e._roomHit = false;
  return true;
}

/** Put the room map in as scene.environment at its level @param {any} e @param {THREE.Texture} tex */
function useRoom(e, tex) {
  e.scene.environment = tex; e.scene.environmentIntensity = roomLevel(e); e._roomWant = 0;
  markOwned(e, 'env');   // the engine's own write: a sky watching scene.environment must not read it as the game taking over
}

/** Called before each render: builds the pending room environment once a material that reads it is in the scene (roomNeeded) @param {any} e */
export function syncRoomEnvironment(e) {
  if (roomNeeded(e)) useRoom(e, roomEnvironment(e));
}

/**
 * start()'s version of syncRoomEnvironment, before compiling: the prefilter's programs compile in parallel with the scene's instead of one by
 * one inside it (~410 ms of synchronous compiles measured on a real GPU, a third of a small scene's first frame). A dry run of the prefilter
 * (compileThrough) starts its programs and leaves an undrawn map of the right size, which goes in as scene.environment at once so the scene
 * compiles for it (the map is part of the program key). The returned promise draws the real map once those programs are ready and puts it in
 * place of the undrawn one, all before start()'s hidden warm-up frame, so no frame shows the map missing. null when nothing waits for it.
 * @param {any} e @returns {Promise<void> | null}
 */
export function prepareRoomEnvironment(e) {
  // built already: nothing to compile. WebGPU: built at once as before; its pipelines are not linked on the page's thread the way WebGL
  // programs are (the main-thread cost there is node building, which compileAsync does not move), and compileThrough is WebGL only
  if (e._roomEnv || isWebGPU(e.renderer)) { syncRoomEnvironment(e); return null; }
  if (!roomNeeded(e)) return null;
  const r = e.renderer, { pmrem, room } = roomPrefilter(e);
  let dry;
  const ready = compileThrough(r, () => { dry = pmrem.fromScene(room, ROOM_SIGMA); });
  e._roomEnv = dry;
  useRoom(e, dry.texture);
  return ready.then(() => {
    // WebGL's PMREMGenerator has no target option and returns a new map: it takes the undrawn one's place
    const done = keepFrame(r, () => pmrem.fromScene(room, ROOM_SIGMA));
    room.dispose?.(); pmrem.dispose();
    e._roomEnv = done;
    if (e.scene.environment === dry.texture) { e.scene.environment = done.texture; markOwned(e, 'env'); }
    dry.dispose();
  });
}

/**
 * Neutral environment for PBR (three's RoomEnvironment prefiltered with PMREM; generated, no asset). Built once per engine on first use;
 * callers outside this file go through refreshRoom so it is only built when something reads it.
 * @param {any} e @returns {THREE.Texture}
 */
function roomEnvironment(e) {
  if (e._roomEnv) return e._roomEnv.texture;
  const { pmrem, room } = roomPrefilter(e);
  e._roomEnv = keepFrame(e.renderer, () => pmrem.fromScene(room, ROOM_SIGMA));
  room.dispose?.(); pmrem.dispose();
  return e._roomEnv.texture;
}

const ROOM_SIGMA = 0.04;   // the prefilter's blur (ROOM_RADIANCE was measured with it)

/** three's RoomEnvironment and a PMREMGenerator for this renderer @param {any} e */
function roomPrefilter(e) {
  // WebGPURenderer needs three/webgpu's PMREMGenerator (registered by threedog/tsl); start() inits the renderer before this can run
  const PMREM = isWebGPU(e.renderer) ? webgpuPart('classes', 'the room environment').PMREMGenerator : THREE.PMREMGenerator;
  return { pmrem: new PMREM(e.renderer), room: new RoomEnvironment() };
}

/**
 * The prefilter renders a few times, but no game frame was drawn: keep renderer.info.render.frame at what it was, because modules read
 * "has the engine drawn yet" from it (look.fog: shader-chunk fog kinds can only change before the first frame)
 * @template T @param {any} r @param {() => T} draw @returns {T}
 */
function keepFrame(r, draw) {
  const info = r.info.render, frame = info.frame;
  try { return draw(); } finally { info.frame = frame; }
}
