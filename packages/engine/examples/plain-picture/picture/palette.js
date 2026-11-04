// @ts-check
// Plain-picture palette: every color and key value of the picture, one copy; the other files here read it.
import { THREE } from '../../../index.js';

const C = (/** @type {number} */ hex) => new THREE.Color(hex);
export const PALETTE = {
  wallA: 0xd9774f, wallB: 0xe8b65a, wallC: 0x4f9a94, wallD: 0xe9dcc0, roof: 0x3a2c3e, door: 0x5a3b34,
  road: 0x55506a, walk: 0x8f8794, pole: 0x2d2a38, windowDark: 0x2f3150, windowLit: 0xffd27a, lamp: 0xffe2a0,
};
// sky and ambient colors at noon and at night (the picture's own palette; the engine's neutral sky colors only nudge the horizon)
export const DAY = { top: C(0x7cc4e8), horizon: C(0xf3e6c8), hemiSky: C(0xfff4e0), hemiGround: C(0xb0a090) };
export const NIGHT = { top: C(0x23285a), horizon: C(0x8a5a78), hemiSky: C(0x9a86b0), hemiGround: C(0x7a5444) };
// Flat colors should come out as written: no filmic curve squashing the darks
export const TONE_MAPPING = THREE.NoToneMapping;
/** 1 until the sun is a bit above the horizon, then falling to 0: what lamps and glow follow @param {number} day uDaylight */
export const nightOf = day => 1 - Math.min(1, day * 4);
