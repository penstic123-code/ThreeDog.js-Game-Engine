// The planned collisions. All in one file on purpose: two parts from one file are the case a stack alone cannot tell apart.
import * as THREE from 'three';

/** A second claim on the fog: refused at install */
export const mist = () => ({ name: 'mist', type: 'picture', provides: ['fog'], install() {} });

/** Takes the fog over from rain, cleanly: for the replaces swap */
export const haze = () => ({ name: 'haze', type: 'picture', provides: ['fog'], install(e, ctx) {
  e.scene.fog = new THREE.Fog(0x888888, 5, 90);
  ctx.track({ remove() { e.scene.fog = null; } });
} });

/** Two parts write the sun, neither declares it */
export const dawn = () => ({ name: 'dawn', type: 'picture', install(e, ctx) {
  ctx.track(e.onRender(() => { e.scene.getObjectByName('sun').intensity = 0.4; }));
} });
export const dusk = () => ({ name: 'dusk', type: 'picture', install(e, ctx) {
  ctx.track(e.onRender(() => { e.scene.getObjectByName('sun').intensity = 0.9; }));
} });

/** Writes a value rain holds: every frame, and from a listener */
export const gust = () => ({ name: 'gust', type: 'picture', install(e, ctx) {
  ctx.track(e.onRender(() => { e.scene.fog.far = 30; }));
  ctx.track(e.events.on('gust:blow', () => { e.scene.fog.color.setHex(0x112233); }));
} });

/** Tracks nothing: everything it adds stays when it goes */
export const messy = () => ({ name: 'messy', type: 'picture', install(e) {
  const flash = new THREE.PointLight(0xffffff, 1, 10);
  flash.name = 'flash';
  const crate = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  crate.name = 'crate';
  e.scene.add(flash, crate);
  e.post.add({ name: 'messyTint', fuse: { glsl: 'color.rgb *= 0.9;', tsl: (color, _uv, { tsl }) => tsl.vec4(color.rgb.mul(0.9), color.a) }, slot: 'ldr' });
  e.onRender(() => { crate.rotation.y += 0.01; });
} });

/** Holds the tone and writes it only from a listener: nothing it did at install shows its file except ctx.track */
export const quiet = () => ({ name: 'quiet', type: 'picture', provides: ['tone'], install(e, ctx) {
  ctx.track(e.events.on('quiet:go', () => { e.renderer.toneMappingExposure = 1.7; }));
} });

/** A claim with a typo: declared, and guarding nothing */
export const typo = () => ({ name: 'typo', type: 'picture', provides: ['fgo'], install() {} });
