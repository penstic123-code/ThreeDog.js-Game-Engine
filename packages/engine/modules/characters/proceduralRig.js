// The procedural body of a Character (split out of Character.js): the gray capsule used when nothing draws a character, attaching a style pack's rig,
// and the limb swing / body bob used when the character has no skeletal animation.
// A rig is { root, body?, head?, joints?: { name: Group }, limbs: [{ joint, offset: 0 | Math.PI, amp, kind: 'arm' | 'leg', side? }] }; the style pack builds it.
import * as THREE from 'three';
import { makeMaterial } from '../../render/materials.js';
import { warnOnce } from '../../core/validate.js';

/** Warned once when no style pack and no model give the character a body */
export const NO_CHARACTER = 'characters: no style pack / model given, so characters are gray capsules (a placeholder). Pass one: a model '
  + "(createPlayer({ model: 'hero' }) or style.character.model), or a style pack whose style.character.create builds one, "
  + "e.g. createEngine({ style: lowpoly }) with lowpoly from '@threedog/style-lowpoly'";

/** Neutral placeholder when the style pack draws no character: one gray capsule, no limbs (the shape belongs to style packs) */
export function capsule(color, engine) {
  const body = new THREE.Group(); body.position.y = 0.85;
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 12).translate(0, -0.05, 0), makeMaterial('character', { color }, engine));
  m.castShadow = true; body.add(m);
  const root = new THREE.Group(); root.add(body);
  return { root, body };
}

/** Put a rig under the character root and remember its parts */
export function useRig(ch, rig) {
  ch.root.add(rig.root); ch._rig = rig;
  ch.hips = rig.body || rig.root; ch.head = rig.head || null;
  ch.bodyBase = ch.hips.position.y;
  ch.limbs = rig.limbs || [];
  // named joints (lowpoly humanoid: armL armR legL legR) become properties so game poses can grab them; never shadow a Character field
  for (const k in rig.joints || {}) {
    if (!(k in ch)) ch[k] = rig.joints[k];
    else if (ch[k] !== rig.joints[k]) warnOnce(`character rig: joint "${k}" has the same name as the Character field ch.${k}, so ch.${k} stays the field; use rig.joints.${k} (or rename the joint)`);
  }
}

/** Swing the limbs and bob the body for the current state (sp = move amount, t = elapsed seconds, st = character state) */
export function animateRig(ch, sp, t, st) {
  const amp = Math.min(1, sp / ch.runSpeed + 0.35);
  let bob = 0, lean = 0;
  for (const L of ch.limbs) {
    let rx = 0, rz = 0;
    const arm = L.kind === 'arm';
    if (st === 'swim') {
      rx = Math.sin(ch.phase * (arm ? 0.9 : 1.4) + L.offset) * (arm ? 1.6 : 0.5);
      rz = arm ? 0.4 * (L.side || 0) : 0;
    } else if (st === 'jump' || st === 'fall') {
      rx = L.kind === 'leg' ? (L.offset ? -0.5 : 0.7) : -0.6;
      rz = arm ? 0.5 * (L.side || 0) : 0;
    } else if (sp > 0.4) rx = Math.sin(ch.phase + L.offset) * L.amp * amp;
    else rx = arm ? Math.sin(t * 1.5) * 0.04 : 0;
    L.joint.rotation.x = rx; if (arm) L.joint.rotation.z = rz || 0.05 * (L.side || 0);
  }
  if (st === 'swim') lean = 1.0;
  else if (sp > 0.4 && ch.grounded) { bob = Math.abs(Math.cos(ch.phase)) * 0.08 * amp; lean = sp / ch.runSpeed * 0.25; }
  else if (ch.grounded) bob = Math.sin(t * 2) * 0.01;
  ch.hips.position.y = ch.bodyBase + bob;
  ch.hips.rotation.x = lean;
  if (ch.head) ch.head.rotation.x = -lean * 0.6;
}
