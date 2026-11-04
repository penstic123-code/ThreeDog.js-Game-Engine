// @ts-check
// Modular building kit (optional technique example, see README.md). Shapes only: every module is built from parameters and drawn with the
// game's own materials, one per slot (wall, trim, roof, frame, glass, accent, awning, sign). Imports only three and three/addons, so a game can
// copy the folder and change anything.
// The pieces are deliberately plain: they teach the method (grid, modules, variation, shared geometry), not a picture.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SLOTS = ['wall', 'trim', 'roof', 'frame', 'glass', 'accent', 'awning', 'sign'];
// a slot the game leaves out borrows from the next one, so one material is enough to start (a gray block-out)
const FALLBACK = { trim: 'wall', roof: 'trim', frame: 'trim', glass: 'frame', accent: 'frame', awning: 'accent', sign: 'trim' };

/** Trim profiles: [out, up] points of a cross-section, outward from the wall face. Swap or add profiles to change a style's trim */
export const PROFILES = {
  flat: [[0, 0], [1, 0], [1, 1], [0, 1]],
  step: [[0, 0], [0.55, 0], [0.55, 0.45], [1, 0.45], [1, 1], [0, 1]],
  cove: [[0, 0], [0.35, 0], [0.5, 0.25], [0.75, 0.45], [1, 0.75], [1, 1], [0, 1]],
};

/** Window variants a street picks from: a few shared variants (not a random size per window) keep the picture designed and the geometry shared */
export const WINDOWS = [
  { width: 0.9, height: 1.4, sill: 0.9, mullions: 1, planter: false },
  { width: 1.1, height: 1.5, sill: 0.8, mullions: 2, planter: true },
  { width: 0.7, height: 1.6, sill: 0.8, mullions: 0, planter: false },
];

/** Seeded random 0..1 (mulberry32): the same seed gives the same street on every machine */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A kit: module builders + an assembler for buildings and streets, all sharing one geometry cache and one slot set.
 * @param {{ prefix?: string, cell?: number, storey?: number, wall?: number, slots: Record<string, THREE.Material>,
 *   profiles?: Record<string, number[][]>, windows?: typeof WINDOWS,
 *   ao?: { bake: (g: THREE.BufferGeometry, o: any) => any, samples?: number, strength?: number } | null }} opts
 *   cell: grid cell in metres (one wall module wide); storey: floor height; wall: wall thickness. slots: the game's materials.
 *   ao: optional vertex AO (pass threedog's bakeVertexAO as `bake`); the slot materials then need vertexColors: true.
 */
export function createModularKit(opts) {
  const known = ['prefix', 'cell', 'storey', 'wall', 'slots', 'profiles', 'windows', 'ao'];
  for (const k of Object.keys(opts ?? {})) if (!known.includes(k)) throw new Error(`createModularKit: unknown option "${k}" (use ${known.join(', ')})`);
  const { prefix = 'mb', cell = 2, storey = 3, wall: T = 0.2, profiles = PROFILES, windows = WINDOWS, ao = null } = opts;
  if (!opts.slots?.wall) throw new Error('createModularKit: slots.wall is required (other slots fall back to it)');
  for (const k of Object.keys(opts.slots)) if (!SLOTS.includes(k)) throw new Error(`createModularKit: unknown slot "${k}" (slots: ${SLOTS.join(', ')})`);
  const slots = /** @type {Record<string, THREE.Material>} */ ({});
  for (const s of SLOTS) { let k = s; while (!opts.slots[k]) k = FALLBACK[k]; slots[s] = opts.slots[k]; }

  // ---- shared geometry and materials ---------------------------------------------------------------------------------------------------
  // One geometry per module + params, one material per slot (+ texture): every copy of a module shares them, which is what lets
  // engine.batching draw a whole street with a few dozen instanced draws instead of one draw per piece.
  const geoCache = new Map(), texCache = new Map(), matCache = new Map();
  const memo = (key, make) => geoCache.get(key) ?? geoCache.set(key, make()).get(key);
  const textured = (slot, tex) => {
    const k = slot + '|' + tex.uuid;
    if (!matCache.has(k)) { const m = slots[slot].clone(); /** @type {any} */ (m).map = tex; m.polygonOffset = true; m.polygonOffsetFactor = -1; matCache.set(k, m); }
    return matCache.get(k);
  };

  /** pieces [geometry, slot][] in module space -> { slot: one merged geometry } (non-indexed, so boxes and extrusions merge together) */
  function bySlot(pieces) {
    const out = {};
    for (const [g, s] of pieces) (out[s] ||= []).push(g.index ? g.toNonIndexed() : g);
    for (const s in out) {
      const merged = mergeGeometries(out[s]);
      if (!merged) throw new Error(`modular kit: pieces of slot "${s}" do not share attributes`);
      out[s] = merged;
    }
    if (ao) for (const s in out) {
      // each slot's geometry is darkened by the module's other parts too (a sill under a frame, the reveal of a window hole)
      const others = Object.keys(out).filter(o => o !== s).map(o => out[o]);
      ao.bake(out[s], { samples: ao.samples ?? 24, strength: ao.strength ?? 0.6, occluders: others, radius: 0.6 });
    }
    return out;
  }
  /** A module's group: one mesh per slot, identity transforms (the group is what the assembler moves) */
  function group(type, geos, maps = {}) {
    const g = new THREE.Group();
    g.name = type;
    for (const [slot, geo] of Object.entries(geos)) {
      const m = new THREE.Mesh(geo, maps[slot] ? textured(slot.split(':')[0], maps[slot]) : slots[slot.split(':')[0]]);
      m.name = slot; m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  // ---- geometry helpers --------------------------------------------------------------------------------------------------------------
  const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  // rounded edges: a raw box reads as a placeholder; a small radius catches a highlight along every edge. One segment (108 triangles, a
  // chamfer with smooth normals) instead of two (300) because sills, pilasters and copings repeat hundreds of times on a street
  const rbox = (w, h, d, r, x = 0, y = 0, z = 0) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.01, h / 2.01, d / 2.01)).translate(x, y, z);
  const shape = pts => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const extrude = (s, depth) => new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  /** A cross-section in (out, up) extruded along x over [-len/2, len/2]: trims, roofs, gable ends */
  const sweepX = (pts, len) => extrude(shape(pts), len).rotateY(-Math.PI / 2).translate(len / 2, 0, 0);
  /** A wall slab of one cell, outer face at z = 0, with holes ([x0, y0, x1, y1] rectangles) */
  function slab(holes = [], h = storey) {
    if (!holes.length) return box(cell, h, T, 0, h / 2, -T / 2);
    const s = shape(rect(-cell / 2, 0, cell / 2, h));
    for (const r of holes) s.holes.push(new THREE.Path(rect(...r).map(([x, y]) => new THREE.Vector2(x, y)).reverse()));
    return extrude(s, T).translate(0, 0, -T);
  }
  /** A wall slab with an opening cut up from the floor (a door): one U-shaped outline, since a hole may not touch the border */
  function slabOpen(w, h) {
    const c = cell / 2, pts = [[-c, 0], [-w / 2, 0], [-w / 2, h], [w / 2, h], [w / 2, 0], [c, 0], [c, storey], [-c, storey]];
    return extrude(shape(pts), T).translate(0, 0, -T);
  }

  // ---- modules (each: params -> Group). Params are plain data, so the manifest can cache, tune and gallery them ---------------------------
  const mod = {
    wall() { return group('wall', memo('wall', () => bySlot([[slab(), 'wall']]))); },

    /** A window: slab with a hole, a proud surround, an inset frame with mullions, recessed glass, a sill and optionally a planter */
    window(p) {
      const { width: w, height: h, sill: y0, mullions = 1, planter = false, inset = 0.08, frame: f = 0.08 } = p;
      return group('window', memo('window' + JSON.stringify(p), () => {
        const z = -inset, bars = [];
        for (let i = 1; i <= mullions; i++) bars.push([box(0.04, h, 0.05, -w / 2 + (w * i) / (mullions + 1), y0 + h / 2, z), 'frame']);
        const surround = shape(rect(-w / 2 - f, y0 - f, w / 2 + f, y0 + h + f));
        surround.holes.push(new THREE.Path(rect(-w / 2, y0, w / 2, y0 + h).map(([x, y]) => new THREE.Vector2(x, y)).reverse()));
        const pieces = [
          [slab([[-w / 2, y0, w / 2, y0 + h]]), 'wall'],
          [extrude(surround, 0.04), 'trim'],                                       // proud of the face: catches light, hides the cut edge
          [rbox(w + 2 * f + 0.12, 0.08, 0.22, 0.02, 0, y0 - 0.035, 0.07), 'trim'],  // the sill sticks out further than the surround; its top 5 mm above the reveal floor so the two never share a plane
          [box(w, 0.05, 0.05, 0, y0 + h / 2, z), 'frame'],                         // transom
          ...bars,
          [box(w, h, 0.01, 0, y0 + h / 2, z - 0.03), 'glass'],                     // recessed: the reveal reads as wall thickness
        ];
        if (planter) pieces.push([rbox(w * 0.9, 0.22, 0.2, 0.03, 0, y0 + 0.115, 0.1), 'accent']);
        return bySlot(pieces);
      }));
    },

    /** A door: U-cut slab, surround on three sides, recessed leaf, a step */
    door(p) {
      const { width: w = 1, height: h = 2.2, inset = 0.1, frame: f = 0.1 } = p;
      return group('door', memo('door' + JSON.stringify(p), () => bySlot([
        [slabOpen(w, h), 'wall'],
        [box(f, h + f, 0.05, -w / 2 - f / 2, (h + f) / 2, 0.025), 'trim'],
        [box(f, h + f, 0.05, w / 2 + f / 2, (h + f) / 2, 0.025), 'trim'],
        [box(w, f, 0.05, 0, h + f / 2, 0.025), 'trim'],
        [box(w, h, 0.05, 0, h / 2, -inset), 'accent'],
        [rbox(w + 0.3, 0.12, 0.35, 0.03, 0, 0.06, 0.17), 'trim'],
      ])));
    },

    /** A corner pilaster, one storey: centered on the corner, a little wider than the wall, so it covers the seam where two walls meet */
    corner(p) {
      const { size = T * 1.6 } = p;
      return group('corner', memo('corner' + size, () => bySlot([[rbox(size, storey, size, 0.03, 0, storey / 2, 0), 'trim']])));
    },

    /** A trim strip of any length along x: cornice, floor band, plinth. profile = a name in profiles */
    trim(p) {
      const { length, profile = 'step', height = 0.25, depth = 0.15 } = p;
      const pts = profiles[profile];
      if (!pts) throw new Error(`modular kit: unknown trim profile "${profile}" (profiles: ${Object.keys(profiles).join(', ')})`);
      return group('trim', memo('trim' + JSON.stringify(p), () => bySlot([[sweepX(pts.map(([o, u]) => [o * depth, u * height]), length), 'trim']])));
    },

    /** A gable roof over width x depth metres (ridge along x), bottom resting on the wall top at the eaves line; gable end walls included */
    gable(p) {
      const { width: W, depth: D, pitch = 0.6, overhang = 0.3, thickness = 0.15 } = p;
      return group('gable', memo('gable' + JSON.stringify(p), () => {
        const a = D / 2 + overhang, r = a * pitch, k = thickness * Math.hypot(1, pitch), drop = r * (1 - D / 2 / a);
        const chevron = [[-a, 0], [0, r], [a, 0], [a, k], [0, r + k], [-a, k]].map(([z, y]) => [z, y - drop]);
        const apex = r * (D / 2) / a;   // the gable triangle under the roof, height above the wall top at the ridge
        const tri = [[-D / 2, 0], [D / 2, 0], [0, apex]];
        return bySlot([
          [sweepX(chevron, W + 2 * overhang), 'roof'],
          [extrude(shape(tri), T).rotateY(-Math.PI / 2).translate(W / 2, 0, 0), 'wall'],
          [extrude(shape(tri), T).rotateY(Math.PI / 2).translate(-W / 2, 0, 0), 'wall'],
        ]);
      }));
    },

    /** A flat roof with a parapet and a coping on top */
    flatRoof(p) {
      const { width: W, depth: D, parapet = 0.6, coping = 0.06 } = p;
      return group('flatRoof', memo('flat' + JSON.stringify(p), () => {
        const t = T, c = coping, y = parapet / 2, top = parapet + 0.04;
        return bySlot([
          [box(W - 2 * t, 0.12, D - 2 * t, 0, 0.06, 0), 'roof'],
          [box(W, parapet, t, 0, y, D / 2 - t / 2), 'wall'], [box(W, parapet, t, 0, y, -D / 2 + t / 2), 'wall'],
          [box(t, parapet, D - 2 * t, W / 2 - t / 2, y, 0), 'wall'], [box(t, parapet, D - 2 * t, -W / 2 + t / 2, y, 0), 'wall'],
          [rbox(W + 2 * c, 0.08, t + 2 * c, 0.02, 0, top, D / 2 - t / 2), 'trim'], [rbox(W + 2 * c, 0.08, t + 2 * c, 0.02, 0, top, -D / 2 + t / 2), 'trim'],
          [rbox(t + 2 * c, 0.08, D - 2 * t - 2 * c, 0.02, W / 2 - t / 2, top, 0), 'trim'], [rbox(t + 2 * c, 0.08, D - 2 * t - 2 * c, 0.02, -W / 2 + t / 2, top, 0), 'trim'],
        ]);
      }));
    },

    /** A striped awning: sloped canvas + valance. The stripes are a gray mask made lazily here; the awning slot's color tints it */
    awning(p) {
      const { width: w = 1.6, depth = 0.9, drop = 0.4, stripes = 7, y = 2.6 } = p;
      const key = 'stripes' + stripes;
      const tex = texCache.get(key) ?? texCache.set(key, stripeTexture(stripes)).get(key);
      const geos = memo('awning' + JSON.stringify(p), () => {
        const len = Math.hypot(depth, drop), ang = Math.atan2(drop, depth);
        const canvas = new THREE.BoxGeometry(w, 0.03, len).translate(0, 0, len / 2).rotateX(ang).translate(0, y, 0);
        const valance = box(w, 0.22, 0.03, 0, y - drop - 0.11, depth);
        return bySlot([[canvas, 'awning'], [valance, 'awning'], [box(0.04, 0.04, depth, -w / 2, y - drop, depth / 2), 'frame'],
          [box(0.04, 0.04, depth, w / 2, y - drop, depth / 2), 'frame']]);
      });
      return group('awning', geos, { awning: tex });
    },

    /** A sign board with text painted on a canvas (white ground, dark letters: a mask the sign slot's color tints) */
    sign(p) {
      const { text = 'SIGN', width: w = 1.6, height: h = 0.45, y = 3.25 } = p;
      const key = 'sign' + text + w + h;
      const tex = texCache.get(key) ?? texCache.set(key, textTexture(text, w / h)).get(key);
      const geos = memo('sign' + JSON.stringify(p), () => bySlot([
        [rbox(w, h, 0.08, 0.03, 0, y, 0.04), 'sign'],
        [new THREE.PlaneGeometry(w - 0.08, h - 0.08).translate(0, y, 0.081), 'sign:face'],
      ]));
      return group('sign', geos, { 'sign:face': tex });
    },

    /** A chimney: a rounded column and a wider cap */
    chimney(p) {
      const { width: w = 0.5, height: h = 2 } = p;
      return group('chimney', memo('chimney' + JSON.stringify(p), () => bySlot([
        [rbox(w, h, w, 0.04, 0, h / 2, 0), 'wall'], [rbox(w + 0.12, 0.12, w + 0.12, 0.03, 0, h + 0.06, 0), 'trim']])));
    },
  };

  // ---- assembler -----------------------------------------------------------------------------------------------------------------------
  const SIDES = ['front', 'right', 'back', 'left'];
  /**
   * A building: footprint W x D cells, floors, a facade pattern per side ('/' separates floors, ground floor first, the last row repeats:
   * 'WDW/WWW'), a roof. Letters: W window, S shop window (window + awning), D door, . blank wall.
   * Each module group carries userData.module = { type, side, floor, i } so tools and tests can find it; the wall slab mesh is named 'wall'.
   */
  function building(p) {
    const { width = 3, depth = 2, floors = 2, roof = 'gable', pitch = 0.6, parapet = 0.6, trim = 'step', window: wv = 0,
      sign = '', chimney = false } = p;
    const W = width * cell, D = depth * cell, H = floors * storey, root = new THREE.Group(), win = windows[wv % windows.length];
    root.name = 'building';
    const facade = { front: p.front ?? 'W'.repeat(width), back: p.back ?? 'W'.repeat(width), left: p.left ?? '.'.repeat(depth), right: p.right ?? '.'.repeat(depth) };
    const place = (g, x, y, z, ry, info) => { g.position.set(x, y, z); g.rotation.y = ry; g.userData.module = info; root.add(g); return g; };
    // where cell i of a side sits, and which way it faces (module space: x along the facade, +z out)
    const frame = (side, i) => {
      const n = side === 'front' || side === 'back' ? width : depth, u = -(n * cell) / 2 + (i + 0.5) * cell;
      return side === 'front' ? [u, D / 2, 0] : side === 'back' ? [-u, -D / 2, Math.PI] : side === 'right' ? [W / 2, -u, Math.PI / 2] : [-W / 2, u, -Math.PI / 2];
    };
    for (const side of SIDES) {
      const rows = facade[side].split('/'), n = side === 'front' || side === 'back' ? width : depth;
      for (const r of rows) if (r.length !== n) throw new Error(`modular kit: facade ${side} row "${r}" has ${r.length} letters, the footprint side has ${n} cells`);
      let signed = false;
      for (let f = 0; f < floors; f++) {
        const row = rows[Math.min(f, rows.length - 1)];
        for (let i = 0; i < n; i++) {
          const ch = row[i], [x, z, ry] = frame(side, i), info = { type: ch, side, floor: f, i };
          if (ch === 'D' && f > 0) throw new Error(`modular kit: a door (D) on floor ${f} of side ${side}; doors go on the ground floor`);
          const g = ch === 'W' ? mod.window(win) : ch === 'S' ? mod.window({ ...win, width: cell * 0.75, height: storey * 0.62, sill: 0.45, planter: false })
            : ch === 'D' ? mod.door({}) : ch === '.' ? mod.wall() : null;
          if (!g) throw new Error(`modular kit: unknown facade letter "${ch}" (W window, S shop window, D door, . wall)`);
          place(g, x, f * storey, z, ry, info);
          if (ch === 'S') place(mod.awning({ width: cell * 0.85, y: storey * 0.88 }), x, f * storey, z, ry, { type: 'awning', side, floor: f, i });
          if (ch === 'D' && sign && !signed && side === 'front') {
            signed = true;
            place(mod.sign({ text: sign, width: cell * 0.8, y: storey * 0.85 }), x, 0, z, ry, { type: 'sign', side, floor: 0, i });
          }
        }
      }
    }
    // pilasters on the four corners of every floor, then trim bands: front/back strips run past the corners by their depth, side strips
    // stop at the wall faces, so the strips touch without overlapping (overlapping coplanar faces would flicker)
    for (let f = 0; f < floors; f++) for (const [x, z] of [[W / 2, D / 2], [-W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]]) {
      place(mod.corner({}), x, f * storey, z, 0, { type: 'corner', floor: f });
    }
    if (trim !== 'none') for (let f = 1; f <= floors; f++) {
      const top = f === floors, h = top ? 0.3 : 0.18, d = top ? 0.22 : 0.12, y = f * storey - h;
      for (const side of SIDES) {
        const along = side === 'front' || side === 'back', len = along ? W + 2 * d : D, [, , ry] = frame(side, 0);
        const [x, z] = side === 'front' ? [0, D / 2] : side === 'back' ? [0, -D / 2] : side === 'right' ? [W / 2, 0] : [-W / 2, 0];
        place(mod.trim({ length: len, profile: trim, height: h, depth: d }), x, y, z, ry, { type: 'trim', side, floor: f });
      }
    }
    if (roof === 'gable') {
      place(mod.gable({ width: W, depth: D, pitch }), 0, H, 0, 0, { type: 'roof' });
      if (chimney) place(mod.chimney({ height: D / 2 * pitch + 1.2 }), W / 2 - cell / 2, H, -D / 4, 0, { type: 'chimney' });
    } else if (roof === 'flat') place(mod.flatRoof({ width: W, depth: D, parapet }), 0, H, 0, 0, { type: 'roof' });
    else throw new Error(`modular kit: unknown roof "${roof}" (gable, flat)`);
    root.userData.building = { cells: [width, depth], floors, size: [W, H, D] };
    return root;
  }

  /**
   * A street: count buildings in a row along +x, front faces on z = 0, each snapped to whole cells with gap cells between them.
   * Variation is seeded and chosen from a few options per trait (floors, width, roof, window variant, trim profile, door spot, shop
   * fronts, sign), so no two neighbours repeat yet geometry stays shared.
   */
  function street(p) {
    const { seed = 1, count = 10, gap = 1, signs = 'BAKERY,BOOKS,CAFE,TOOLS,TEA,HOTEL' } = p;
    const rand = rng(seed), pick = a => a[Math.floor(rand() * a.length)], root = new THREE.Group(), names = signs.split(',').filter(Boolean);
    const trims = Object.keys(profiles);
    root.name = 'street';
    let x = 0;
    for (let b = 0; b < count; b++) {
      const width = pick([2, 3, 3, 4]), depth = pick([2, 3]), floors = pick([1, 2, 2, 3]), roof = rand() < 0.6 ? 'gable' : 'flat';
      const door = Math.floor(rand() * width), shop = rand() < 0.5;
      // upper floors mirror around the middle: a symmetric facade reads as designed, a fully random one as noise
      const half = Array.from({ length: Math.ceil(width / 2) }, () => (rand() < 0.8 ? 'W' : '.'));
      const upper = [...half, ...half.slice(0, Math.floor(width / 2)).reverse()].join('');
      const ground = Array.from({ length: width }, (_, i) => (i === door ? 'D' : shop ? 'S' : 'W')).join('');
      const params = {
        width, depth, floors, roof, pitch: pick([0.5, 0.7]), parapet: pick([0.4, 0.8]), trim: pick(trims), window: Math.floor(rand() * windows.length),
        front: floors > 1 ? `${ground}/${upper}` : ground, back: upper, left: Array.from({ length: depth }, () => (rand() < 0.3 ? 'W' : '.')).join(''),
        right: '.'.repeat(depth), sign: shop && names.length ? pick(names) : '', chimney: roof === 'gable' && rand() < 0.5,
      };
      const g = building(params);
      g.position.set((x + width / 2) * cell, 0, -(depth * cell) / 2);   // whole cells: every module edge lands on the grid
      g.userData.params = params;
      root.add(g);
      x += width + gap;
    }
    root.userData.street = { seed, count, length: (x - gap) * cell };
    return root;
  }

  // ---- manifest entries: { build, params } so threedog gallery, hot swap and the panel's tune work on every piece -----------------------
  // cache: false because the slot materials are live objects of the game, not params (the dev cache would keep a stale material)
  const n = (d, min, max) => ({ type: 'number', default: d, min, max });
  const entry = (build, params) => ({ build, params, cache: false });
  const w0 = windows[0];
  const models = {
    [`${prefix}-wall`]: entry(() => mod.wall(), {}),
    [`${prefix}-window`]: entry(p => mod.window(p), { width: n(w0.width, 0.3, cell - 0.3), height: n(w0.height, 0.4, storey - 0.6), sill: n(w0.sill, 0.2, storey - 1),
      mullions: { type: 'int', default: w0.mullions, min: 0, max: 4 }, planter: { type: 'bool', default: !!w0.planter }, inset: n(0.08, 0, T - 0.04) }),
    [`${prefix}-door`]: entry(p => mod.door(p), { width: n(1, 0.6, cell - 0.4), height: n(2.2, 1.6, storey - 0.4) }),
    [`${prefix}-corner`]: entry(p => mod.corner(p), { size: n(T * 1.6, T, 1) }),
    [`${prefix}-trim`]: entry(p => mod.trim(p), { length: n(cell, 0.5, 20), profile: { type: 'string', default: 'step', values: Object.keys(profiles) },
      height: n(0.25, 0.05, 1), depth: n(0.15, 0.02, 0.6) }),
    [`${prefix}-gable`]: entry(p => mod.gable(p), { width: n(cell * 3, cell, 20), depth: n(cell * 2, cell, 12), pitch: n(0.6, 0.2, 1.5), overhang: n(0.3, 0, 1) }),
    [`${prefix}-flatRoof`]: entry(p => mod.flatRoof(p), { width: n(cell * 3, cell, 20), depth: n(cell * 2, cell, 12), parapet: n(0.6, 0.1, 1.5) }),
    [`${prefix}-awning`]: entry(p => mod.awning(p), { width: n(1.6, 0.5, 6), depth: n(0.9, 0.3, 2), drop: n(0.4, 0, 1), stripes: { type: 'int', default: 7, min: 1, max: 20 } }),
    [`${prefix}-sign`]: entry(p => mod.sign(p), { text: { type: 'string', default: 'SIGN' }, width: n(1.6, 0.4, 6), height: n(0.45, 0.2, 2) }),
    [`${prefix}-chimney`]: entry(p => mod.chimney(p), { width: n(0.5, 0.2, 1.5), height: n(2, 0.5, 5) }),
    [`${prefix}-building`]: entry(p => building(p), {
      width: { type: 'int', default: 3, min: 1, max: 8 }, depth: { type: 'int', default: 2, min: 1, max: 6 }, floors: { type: 'int', default: 2, min: 1, max: 8 },
      roof: { type: 'string', default: 'gable', values: ['gable', 'flat'] }, pitch: n(0.6, 0.2, 1.5), parapet: n(0.6, 0.1, 1.5),
      trim: { type: 'string', default: 'step', values: [...Object.keys(profiles), 'none'] }, window: { type: 'int', default: 0, min: 0, max: windows.length - 1 },
      front: { type: 'string', default: 'SDS/WWW' }, back: { type: 'string', default: 'W.W' }, left: { type: 'string', default: '.W' }, right: { type: 'string', default: '..' },
      sign: { type: 'string', default: 'SHOP' }, chimney: { type: 'bool', default: true },
    }),
    [`${prefix}-street`]: entry(p => street(p), { seed: { type: 'int', default: 1, min: 0, max: 99999 }, count: { type: 'int', default: 10, min: 1, max: 40 },
      gap: { type: 'int', default: 1, min: 0, max: 4 }, signs: { type: 'string', default: 'BAKERY,BOOKS,CAFE,TOOLS,TEA,HOTEL' } }),
  };

  /**
   * Merge a finished, static group into one mesh per material (world transforms baked in): the fewest draw calls (one per slot), at the price
   * of culling (the whole merged mesh is drawn when any part is on screen) and of editing single pieces later. The input is left as it was.
   * @param {THREE.Object3D} root
   */
  function merge(root) {
    root.updateWorldMatrix(true, true);
    const byMat = new Map(), out = new THREE.Group();
    root.traverse(o => {
      const m = /** @type {THREE.Mesh} */ (o);
      if (!m.isMesh) return;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      g.clearGroups();
      (byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)).push(g);
    });
    for (const [mat, list] of byMat) {
      const mesh = new THREE.Mesh(mergeGeometries(list), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      out.add(mesh);
      for (const g of list) g.dispose();
    }
    out.name = root.name + '-merged';
    return out;
  }

  return {
    /** asset pack: engine.assets.manifest(kit.pack) */
    pack: { name: `${prefix}-kit`, models },
    modules: mod, building, street, merge, cell, storey, wall: T, slots,
    /** shared geometries made so far (each module + params once) */
    get geometries() { return geoCache.size; },
    /** Free every geometry, texture and textured material the kit made (the slot materials are the game's and stay) */
    dispose() {
      for (const g of geoCache.values()) for (const x of Object.values(g)) x.dispose();
      for (const t of texCache.values()) t.dispose();
      for (const m of matCache.values()) m.dispose();
      geoCache.clear(); texCache.clear(); matCache.clear();
    },
  };
}

/** Vertical stripes, white and light gray: a luminance mask (the material's color supplies the hue) */
function stripeTexture(stripes) {
  const c = document.createElement('canvas'); c.width = stripes * 2 * 8; c.height = 8;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  for (let i = 0; i < stripes * 2; i++) { x.fillStyle = i % 2 ? '#bdbdbd' : '#ffffff'; x.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;   // crisp stripe edges up close
  return t;
}
/** Text centered on white, sized to fill the board */
function textTexture(text, aspect) {
  const h = 64, c = document.createElement('canvas'); c.width = Math.round(h * aspect); c.height = h;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, h);
  x.fillStyle = '#262626'; x.textAlign = 'center'; x.textBaseline = 'middle';
  let size = h * 0.62;
  x.font = `bold ${size}px sans-serif`;
  const fit = x.measureText(text).width;
  if (fit > c.width * 0.9) { size *= (c.width * 0.9) / fit; x.font = `bold ${size}px sans-serif`; }
  x.fillText(text, c.width / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
