// Ragdoll skeleton reading: a graph of parts over a skeleton, each measured for its real length and thickness. The default graph comes from recognising each tool's bone names
// (Mixamo, Blender, Unreal, Bip01, VRM, Quaternius...) as the 11 parts of a human body; a game's own graph (four legs, a tail) goes through the same measuring.
// Why this is apart from ragdoll.js: it only reads, never writes, and never touches Rapier, so it can be tested without physics.
import * as THREE from 'three';
import { vec3 } from '../../core/base/math.js';
import { codedError } from '../../core/base/errorHints.js';

const PARTS = ['hips', 'chest', 'head', 'upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR'];
// Compare after dropping the prefix words an export tool adds. Trailing digits are stripped first (mixamorig1, Bip01)
const NOISE = new Set(['mixamorig', 'def', 'org', 'bip', 'b', 'j', 'jnt', 'joint', 'bone', 'cc', 'base', 'armature', 'rig', 'characterarmature', 'bn', 'valvebiped', 'c']);
// Names are in priority order. 'leg' goes last and the lower leg picks first: some skeletons use UpLeg + Leg (Leg is the lower leg), others Leg + Shin (Leg is the thigh). 'arm' counts as the upper arm only (LeftArm + LeftForeArm)
const NAMES = {
  upperArm: ['upperarm', 'uparm', 'humerus', 'arm'], lowerArm: ['forearm', 'lowerarm', 'loarm', 'elbow'],
  upperLeg: ['thigh', 'upperleg', 'upleg', 'femur', 'leg'], lowerLeg: ['shin', 'calf', 'lowerleg', 'loleg', 'knee', 'tibia', 'leg'],
};

const D = Math.PI / 180;
// Default range of motion (radians, relative to bind pose). bend is positive forward (backward for knees), side is sideways, twist is around the bone. This is physical plausibility, not looks
const LIMITS = {
  chest: { bend: [-30 * D, 40 * D], side: [-25 * D, 25 * D], twist: [-30 * D, 30 * D] },
  head: { bend: [-40 * D, 50 * D], side: [-35 * D, 35 * D], twist: [-60 * D, 60 * D] },
  upperArm: { bend: [-60 * D, 120 * D], side: [-100 * D, 100 * D], twist: [-70 * D, 70 * D] },
  lowerArm: { bend: [0, 145 * D], side: [-3 * D, 3 * D], twist: [-60 * D, 60 * D] },
  upperLeg: { bend: [-25 * D, 110 * D], side: [-45 * D, 45 * D], twist: [-35 * D, 35 * D] },
  lowerLeg: { bend: [0, 140 * D], side: [-3 * D, 3 * D], twist: [-5 * D, 5 * D] },
};
const SHARE = { hips: 0.16, chest: 0.3, head: 0.08, upperArm: 0.03, lowerArm: 0.025, upperLeg: 0.11, lowerLeg: 0.07 };   // how the total mass is split
const WHOLE = 70;   // kg of a body whose graph or call names none
const OPEN = { bend: [-45 * D, 45 * D], side: [-45 * D, 45 * D], twist: [-30 * D, 30 * D] };   // a part of a game's graph that gives no limits: loose, but no joint folds through itself

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
      + `Bones in it: ${names}${skeleton.bones.length > 40 ? ', ...' : ''}. Fix: name them, e.g. engine.rigid.ragdoll(character, { bones: { ${missing[0] ?? 'hips'}: '<bone name>' } }); a body that is not a human: the rule 'ragdoll.graph', recipe 11`);
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
 * The default graph: the 11 parts of a human body, read from the skeleton. Everything that knows a body has legs lives here, so a wolf or a snake is just another graph.
 * Beyond the data any graph has: kind names the limits a game can widen for both sides at once, end is the part a bone points at, forward the way this joint bends.
 * @returns {Record<string, any>}
 */
export function humanoidGraph(mesh, given) {
  const map = readBones(mesh.skeleton, given), sk = mesh.skeleton, rest = {};
  for (const n of PARTS) rest[n] = restOf(sk, map[n]);
  const right = v1.subVectors(rest.upperLegR.p, rest.upperLegL.p).clone().normalize();
  const up = new THREE.Vector3().subVectors(rest.chest.p, rest.hips.p).normalize();
  const forward = new THREE.Vector3().crossVectors(up, right).normalize();
  return Object.fromEntries(PARTS.map(name => {
    const kind = name.replace(/[LR]$/, ''), side = name.slice(-1);
    let parent = null;
    for (let o = map[name].parent; o && !parent; o = o.parent) parent = PARTS.find(n => map[n] === o) ?? null;
    if (name !== 'hips' && !parent) throw codedError('rigid-misuse', `rigid.ragdoll(): bone '${map[name].name}' (${name}) is not under hips ('${map.hips.name}'), so nothing holds it. Fix: pass bones: { hips: '<the bone every body part hangs from>' }`);
    const end = { hips: 'chest', chest: 'head', head: 'top', upperArm: 'lowerArm' + side, upperLeg: 'lowerLeg' + side }[kind];
    // Knees bend backward, other joints forward
    return [name, { bone: map[name], parent, kind, limits: LIMITS[kind], mass: WHOLE * SHARE[kind], end, forward: kind === 'lowerLeg' ? forward.clone().negate() : forward, up }];
  }));
}

/** A graph's bone: a name or the bone itself; one outside the skeleton is refused by name */
function boneOf(sk, name, b) {
  const bone = b?.isObject3D ? b : sk.bones.find(x => x.name === b);
  if (bone && sk.bones.includes(bone)) return bone;
  throw codedError('rigid-misuse', `ragdoll.graph: part '${name}' names bone '${b?.name ?? b}', which is not in the skeleton. Bones in it: ${sk.bones.slice(0, 40).map(x => x.name).join(', ')}`);
}

/**
 * Static shape of each part of a graph { part: { bone, parent, limits, mass, end, forward, kind, up } } (all in bind space, in bind-time length units):
 * { name, kind, bone, parent, p, q, end, radius, frame, limits, mass }, parents before children, so the one part without a parent comes first.
 * end: the tip of this bone, from the real bone length, not guessed by proportion (a misaligned collider is where mesh deformation comes from). radius: distance from skinned vertices to this bone, so thin and heavy characters both fit.
 * frame: joint frame, x along the bone (twist), y toward positive bend, z the hinge axis.
 */
export function shapeParts(mesh, graph) {
  const bad = why => codedError('rigid-misuse', `ragdoll.graph: ${why}. A graph is { part: { bone, parent, limits?, mass?, end?, forward? } }, one part without a parent`);
  if (!graph || typeof graph !== 'object') throw bad(`got ${String(graph)}`);
  const sk = mesh.skeleton, names = Object.keys(graph), roots = names.filter(n => !graph[n].parent);
  if (names.length < 2 || roots.length !== 1) throw bad(`${names.length} part(s) with ${roots.length} root(s) (${roots.join(', ')})`);
  const parts = names.map(name => {
    const g = graph[name], bone = boneOf(sk, name, g.bone), r = restOf(sk, bone);
    if (g.parent && !graph[g.parent]) throw bad(`part '${name}' has parent '${g.parent}', which is not a part`);
    if (g.parent && !under(bone, boneOf(sk, g.parent, graph[g.parent].bone))) throw bad(`part '${name}': bone '${bone.name}' is not under the bone of its parent '${g.parent}'`);
    return { name, kind: g.kind, bone, parent: g.parent ?? null, p: r.p, q: r.q, end: null, radius: 0, frame: null, limits: { ...OPEN, ...g.limits }, mass: g.mass ?? WHOLE / names.length, d: depth(bone) };
  }).sort((a, b) => a.d - b.d);
  const byName = Object.fromEntries(parts.map(s => [s.name, s]));
  for (const s of parts) if (graph[s.name].end !== 'top') s.end = tipOf(sk, s, parts, byName, graph[s.name].end);
  measure(mesh, parts, graph, byName);
  for (const s of parts) {
    const g = graph[s.name], F = g.forward ? vec3(g.forward) : new THREE.Vector3(0, 0, 1), up = g.up ? vec3(g.up) : new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().subVectors(s.end, s.p).normalize();
    const y = F.clone().addScaledVector(x, -x.dot(F));   // the y axis is the direction the bone tip moves when bend is positive
    if (y.lengthSq() < 1e-4) y.copy(up).addScaledVector(x, -x.dot(up));   // The bone points straight along forward (a rare bind pose)
    y.normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    s.frame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  return parts;
}

/** Where a part ends: the part it names; else the middle of its child parts (the one child when they meet at its own joint); else its first child bone, a hand or a foot; else on along the segment before it */
function tipOf(sk, s, parts, byName, end) {
  if (end) { if (!byName[end]) throw codedError('rigid-misuse', `ragdoll.graph: part '${s.name}' has end '${end}', which is not a part`); return byName[end].p; }
  const kids = parts.filter(c => c.parent === s.name);
  if (kids.length) {
    const mid = kids.reduce((m, c) => m.add(c.p), new THREE.Vector3()).divideScalar(kids.length);
    return mid.distanceTo(s.p) > 1e-5 ? mid : kids[0].p;
  }
  const c = s.bone.children.find(o => o.isBone && sk.bones.includes(o));
  return c ? restOf(sk, c).p : new THREE.Vector3().subVectors(s.p, byName[s.parent].p).add(s.p);
}

/** Measure thickness: assign each vertex to the part of its heaviest-weighted bone and take the 60th percentile of the distance to the segment (outliers such as fingers and capes do not count). A part with end: 'top' (a head) has no next bone, so its top is measured from vertices too */
function measure(mesh, parts, graph, byName) {
  const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, sk = mesh.skeleton;
  const owner = sk.bones.map(b => { for (let o = b; o; o = o.parent) { const s = parts.find(x => x.bone === o); if (s) return s; } return null; });
  const lists = new Map(parts.map(s => [s, []]));
  const pts = new Map(parts.map(s => [s, []]));
  if (pos && si && sw) {
    for (let i = 0; i < pos.count; i++) {
      let best = 0, w = -1;
      for (let k = 0; k < 4; k++) { const wk = sw.getComponent(i, k); if (wk > w) { w = wk; best = si.getComponent(i, k); } }
      const s = owner[best];
      if (s) pts.get(s).push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix));
    }
  }
  // The top: the vertex farthest up; with no vertices, estimate half the distance to the parent
  for (const s of parts) {
    if (graph[s.name].end !== 'top') continue;
    const up = graph[s.name].up ? vec3(graph[s.name].up) : new THREE.Vector3(0, 1, 0);
    let top = 0;
    for (const v of pts.get(s)) top = Math.max(top, v1.subVectors(v, s.p).dot(up));
    s.end = s.p.clone().addScaledVector(up, top > 0 ? top : byName[s.parent].p.distanceTo(s.p) * 0.5);
  }
  for (const s of parts) {
    const list = lists.get(s), len = s.p.distanceTo(s.end);
    for (const v of pts.get(s)) list.push(toSegment(v, s.p, s.end));
    list.sort((a, b) => a - b);
    const r = list.length >= 8 ? list[Math.floor(list.length * 0.6)] : len * 0.25;
    s.radius = THREE.MathUtils.clamp(r, len * 0.08, len * 0.6);
  }
}
