// Ragdoll skeleton reading: recognise each tool's bone names (Mixamo, Blender, Unreal, Bip01, VRM, Quaternius...) as 11 parts, then measure each segment's real length and thickness.
// Why this is apart from ragdoll.js: it only reads, never writes, and never touches Rapier, so it can be tested without physics.
import * as THREE from 'three';
import { codedError } from '../../core/errorHints.js';

const PARTS = ['hips', 'chest', 'head', 'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR'];
// Compare after dropping the prefix words an export tool adds. Trailing digits are stripped first (mixamorig1, Bip01)
const NOISE = new Set(['mixamorig', 'def', 'org', 'bip', 'b', 'j', 'jnt', 'joint', 'bone', 'cc', 'base', 'armature', 'rig', 'characterarmature', 'bn', 'valvebiped', 'c']);
// Names are in priority order. 'leg' goes last and the lower leg picks first: some skeletons use UpLeg + Leg (Leg is the lower leg), others Leg + Shin (Leg is the thigh). 'arm' counts as the upper arm only (LeftArm + LeftForeArm)
const NAMES = {
  upperArm: ['upperarm', 'uparm', 'humerus', 'arm'], lowerArm: ['forearm', 'lowerarm', 'loarm', 'elbow'],
  upperLeg: ['thigh', 'upperleg', 'upleg', 'femur', 'leg'], lowerLeg: ['shin', 'calf', 'lowerleg', 'loleg', 'knee', 'tibia', 'leg'],
};

/** Bone name -> { side: 'L' | 'R' | '', word }: LeftForeArm, upperarm_l, Bip01 L Thigh, DEF-forearm.L, UpperArmR (GLTFLoader eats the dot) all split into the same shape */
function parse(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).map(w => w.toLowerCase().replace(/\d+$/, '')).filter(w => w && !NOISE.has(w));
  let side = '';
  const rest = words.filter(w => {
    if (!side && (w === 'l' || w === 'left')) { side = 'L'; return false; }
    if (!side && (w === 'r' || w === 'right')) { side = 'R'; return false; }
    return true;
  });
  return { side, word: rest.join('') };
}
const depth = b => { let n = 0; for (let o = b; o; o = o.parent) n++; return n; };
const under = (b, top) => { for (let o = b.parent; o; o = o.parent) if (o === top) return true; return false; };
/** The nearest common ancestor of two bones. The torso is found with it, not by name: Spine / Spine2 / chest / spine_03 vary too much between tools, while "where the legs fork, where the arms fork" is the same on every skeleton */
function meet(a, b, bones) {
  for (let o = a; o; o = o.parent) if (bones.has(o) && (o === b || under(b, o))) return o;
  return null;
}

/** Auto-detect bones and fill the parts still empty in the map (bones the game gave claim their place first; other parts cannot reuse them); missing ones stay empty and readBones reports them together */
function detect(skeleton, map) {
  const bones = [...skeleton.bones].map(b => ({ b, ...parse(b.name), d: depth(b) })).sort((x, y) => x.d - y.d);
  const taken = new Set(Object.values(map));
  map.head ??= bones.find(x => x.word === 'head' && !x.side)?.b;
  for (const side of ['L', 'R']) {
    for (const kind of ['upperArm', 'lowerArm', 'lowerLeg', 'upperLeg']) {
      if (map[kind + side]) continue;
      for (const word of NAMES[kind]) {
        const hit = bones.find(x => x.side === side && x.word === word && !taken.has(x.b));
        if (hit) { map[kind + side] = hit.b; taken.add(hit.b); break; }
      }
    }
  }
}

/**
 * Read the skeleton. given maps a part to a bone name or bone object from the game and wins over auto-detection; if any part cannot be read it throws, naming the missing parts and the bone names the skeleton really has.
 * @returns {Record<string, THREE.Bone>}
 */
export function readBones(skeleton, given = {}) {
  const set = new Set(skeleton.bones), map = {}, bad = [];
  for (const k of Object.keys(given)) if (!PARTS.includes(k)) throw codedError('rigid-misuse', `rigid.ragdoll({ bones }): '${k}' is not a part. Parts: ${PARTS.join(', ')}`);
  for (const p of PARTS) {
    const g = given[p];
    if (g == null) continue;
    const b = g.isObject3D ? g : skeleton.bones.find(x => x.name === g);
    if (b && set.has(b)) map[p] = b; else bad.push(`${p}: '${g.name ?? g}' is not in the skeleton`);
  }
  detect(skeleton, map);
  // The torso can only be worked out after the limbs are found; use the game's if it gave one
  if (!map.hips && map.upperLegL && map.upperLegR) map.hips = meet(map.upperLegL, map.upperLegR, set) ?? undefined;
  if (!map.chest && map.upperArmL && map.upperArmR) map.chest = meet(map.upperArmL, map.upperArmR, set) ?? undefined;
  const missing = PARTS.filter(p => !map[p]);
  if (bad.length || missing.length) {
    const names = skeleton.bones.slice(0, 40).map(b => b.name).join(', ');
    throw codedError('rigid-misuse', `rigid.ragdoll(): cannot read this skeleton. Missing: ${[...bad, ...missing.filter(p => !bad.some(s => s.startsWith(p + ':')))].join(', ')}. `
      + `Bones in it: ${names}${skeleton.bones.length > 40 ? ', ...' : ''}. Fix: name them, e.g. engine.rigid.ragdoll(character, { bones: { ${missing[0] ?? 'hips'}: '<bone name>' } })`);
  }
  if (map.hips === map.chest) throw codedError('rigid-misuse', `rigid.ragdoll(): hips and chest are the same bone ('${map.hips.name}'), so the torso has one part. Fix: pass bones: { hips: '<pelvis bone>', chest: '<upper spine bone>' }`);
  return map;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), mt = new THREE.Matrix4();
/** A bone's bind pose (the inverse of boneInverses): whatever pose the animation is in does not affect it, so limits and joint frames get a zero point that does not move with the pose */
function restOf(skeleton, bone) {
  const i = skeleton.bones.indexOf(bone), p = new THREE.Vector3(), q = new THREE.Quaternion();
  mt.copy(skeleton.boneInverses[i]).invert().decompose(p, q, sc);
  return { p, q };
}
/** Distance from a point to a segment */
function toSegment(p, a, b) {
  v2.subVectors(b, a); const l2 = v2.lengthSq();
  const t = l2 > 0 ? THREE.MathUtils.clamp(v3.subVectors(p, a).dot(v2) / l2, 0, 1) : 0;
  return v3.copy(a).addScaledVector(v2, t).distanceTo(p);
}

/**
 * Static shape of each part (all in bind space, in bind-time length units): { name, kind, bone, parent, p, q, end, radius, frame }, parents before children.
 * end: the tip of this bone, from the real bone length, not guessed by proportion (a misaligned collider is where mesh deformation comes from). radius: distance from skinned vertices to this bone, so thin and heavy characters both fit.
 * frame: joint frame, x along the bone (twist), y toward positive bend, z the hinge axis.
 */
export function shapeParts(mesh, map) {
  const sk = mesh.skeleton, rest = {};
  for (const n of PARTS) rest[n] = restOf(sk, map[n]);
  const right = v1.subVectors(rest.upperLegR.p, rest.upperLegL.p).clone().normalize();
  const up = new THREE.Vector3().subVectors(rest.chest.p, rest.hips.p).normalize();
  const forward = new THREE.Vector3().crossVectors(up, right).normalize();
  const childEnd = (bone, p) => {   // Hand or foot: the end is the first child bone; with no child, extend along the previous segment's direction (end is corrected from vertices later)
    const c = bone.children.find(o => o.isBone && sk.bones.includes(o));
    return c ? restOf(sk, c).p : null;
  };
  const parts = PARTS.map(name => {
    const kind = name.replace(/[LR]$/, ''), side = name.slice(-1), r = rest[name];
    let end;
    if (name === 'hips') end = rest.chest.p;
    else if (name === 'chest') end = rest.head.p;
    else if (kind === 'upperArm') end = rest['lowerArm' + side].p;
    else if (kind === 'upperLeg') end = rest['lowerLeg' + side].p;
    else if (name === 'head') end = null;
    else end = childEnd(map[name], r.p) ?? new THREE.Vector3().subVectors(r.p, rest[(kind === 'lowerArm' ? 'upperArm' : 'upperLeg') + side].p).add(r.p);
    let parent = null;
    for (let o = map[name].parent; o && !parent; o = o.parent) parent = PARTS.find(n => map[n] === o) ?? null;
    if (name !== 'hips' && !parent) throw codedError('rigid-misuse', `rigid.ragdoll(): bone '${map[name].name}' (${name}) is not under hips ('${map.hips.name}'), so nothing holds it. Fix: pass bones: { hips: '<the bone every body part hangs from>' }`);
    return { name, kind, bone: map[name], parent, p: r.p, q: r.q, end, radius: 0, frame: null, d: depth(map[name]) };
  }).sort((a, b) => a.d - b.d);
  measure(mesh, parts, up);
  for (const s of parts) {
    const x = new THREE.Vector3().subVectors(s.end, s.p).normalize();
    // Knees bend backward, other joints forward: the y axis is the direction the bone tip moves when bend is positive
    const y = forward.clone().multiplyScalar(s.kind === 'lowerLeg' ? -1 : 1).addScaledVector(x, s.kind === 'lowerLeg' ? x.dot(forward) : -x.dot(forward));
    if (y.lengthSq() < 1e-4) y.copy(up).addScaledVector(x, -x.dot(up));   // The bone points straight forward (a rare bind pose)
    y.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    s.frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  return parts;
}

/** Measure thickness: assign each vertex to the part of its heaviest-weighted bone and take the 60th percentile of the distance to the segment (outliers such as fingers and capes do not count). The head has no next bone, so its top is measured from vertices too */
function measure(mesh, parts, up) {
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = mesh.skeleton;
  const owner = sk.bones.map(b => { for (let o = b; o; o = o.parent) { const s = parts.find(x => x.bone === o); if (s) return s; } return null; });
  const lists = new Map(parts.map(s => [s, []])), head = parts.find(s => s.name === 'head');
  const pts = new Map(parts.map(s => [s, []]));
  if (pos && si && sw) {
    for (let i = 0; i < pos.count; i++) {
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; best = si.getComponent(i, k); } }
      const s = owner[best];
      if (s) pts.get(s).push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix));
    }
  }
  // Top of the head: the vertex farthest up along the torso; with no vertices, estimate half the neck-to-chest distance
  let top = 0;
  for (const v of pts.get(head)) top = Math.max(top, v1.subVectors(v, head.p).dot(up));
  const chest = parts.find(s => s.name === 'chest');
  head.end = head.p.clone().addScaledVector(up, top > 0 ? top : chest.p.distanceTo(head.p) * 0.5);
  for (const s of parts) {
    const list = lists.get(s), len = s.p.distanceTo(s.end);
    for (const v of pts.get(s)) list.push(toSegment(v, s.p, s.end));
    list.sort((a, b) => a - b);
    const r = list.length >= 8 ? list[Math.floor(list.length * 0.6)] : len * 0.25;
    s.radius = THREE.MathUtils.clamp(r, len * 0.08, len * 0.6);
  }
}
