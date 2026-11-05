// Scatter by rule: where instances go in one ground chunk (plants, rocks), pure computation over a ground's height, slope and type
// functions, no three.js dependency. In core because more than one module places with it -- the generated-ground chunk worker and the
// chunks laid over any other ground provider (a level model, a code-built ground) -- and a rule must mean the same on every kind of ground.

// mulberry32 whose state can be reset: each placement attempt gets its own stream, so skipping an attempt (edited ground, failed rule)
// never shifts the random numbers of later attempts -- the other trees stay put and felled-tree ids stay valid
import { mulberry32 } from '../base/mulberry32.js';

function stream() {
  const st = { state: 0 };
  const rnd = () => mulberry32(st);
  rnd.seed = s => { st.state = s | 0; };
  return rnd;
}

/** Seeded value noise: hash(x, z, salt) 0..1, noise(x, z) smooth 0..1, fbm(x, z, octaves). The terrain generator and cluster rules use the same one */
export function makeNoise(seed) {
  const SEED = seed | 0;
  function hash(x, z, salt = 0) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + SEED + Math.imul(salt, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function noise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  return { hash, noise, fbm };
}

// Rule defaults. Heights are unlimited unless the rule says so: a level floor at y = 12 or a cave at y = -30 grows plants too
// (a terrain game names its own band above the water, e.g. minHeight: 1.5)
const RULE = { perChunk: 100, minHeight: -Infinity, maxHeight: Infinity, maxSlope: 0.6, cluster: 'none', scale: [0.8, 1.2], stretch: [1, 1], sink: 0.1,
  tintJitter: 0.1, tints: [], salt: 0, biomes: null, collider: 0, avoidFlat: true };

// Explicit placements (rule.positions: [[x, z], [x, z, scale, yaw], ...]) bucketed by chunk once per rule object and chunk size: the worker keeps
// one rule object per species and the main thread keeps sp.rule, so a long list is sorted once, not on every chunk load
const BUCKETS = new WeakMap();
function bucketsOf(rule, CHUNK) {
  let b = BUCKETS.get(rule);
  if (b && b.chunk === CHUNK) return b.map;
  const map = new Map();
  rule.positions.forEach((p, i) => { const k = Math.floor(p[0] / CHUNK) + ',' + Math.floor(p[1] / CHUNK); let l = map.get(k); if (!l) map.set(k, l = []); l.push(i); });
  BUCKETS.set(rule, b = { chunk: CHUNK, map });
  return map;
}

/**
 * Placement over one ground. chunk: edge length (m); seed: placement seed; surface / slope / typeAt (x, z): the ground;
 * skip(x, z): true where nothing may grow (edited terrain cells, flattened plots when the rule says avoidFlat), optional.
 * place(cx, cz, rule, density) returns instance matrices (column-major, chunk-local x / z), instance colors, collision circles (world x, z, radius)
 * and stable ids (the attempt index, independent of density; with rule.positions the index in that list).
 * rule.positions replaces the random attempts: every listed spot in this chunk gets one instance at the ground height (scale / yaw from the entry
 * or the rule's random ranges); the scatter filters (perChunk, chance, cluster, heights, slope, biomes, avoidFlat) and density do not apply --
 * the game already chose the spot. skip still applies: dug or raised ground loses what grew there either way.
 */
export function makePlacer({ chunk: CHUNK, seed, surface, slope, typeAt, fbm, skip = null, flat = null }) {
  const SEED = seed | 0;
  return function place(cx, cz, rule, density = 1) {
    const r = { ...RULE, ...rule };
    const base = Math.imul(cx, 92821) ^ Math.imul(cz, 68917) ^ SEED ^ Math.imul(r.salt + 1, 40503), rnd = stream();
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const listed = rule?.positions ? bucketsOf(rule, CHUNK).get(cx + ',' + cz) ?? [] : null;
    const attempts = listed ? listed.length : Math.round(r.perChunk * density);
    const m = new Float32Array(attempts * 16), c = new Float32Array(attempts * 3), k = new Float32Array(r.collider ? attempts * 3 : 0), ids = new Uint32Array(attempts);
    let n = 0;
    // one instance at local (lx, lz) on height h; s / yaw null = drawn from the rule's ranges. The same code for both paths, so a listed plant
    // gets the same sink, stretch, tints and collider as a scattered one
    const put = (id, lx, lz, h, s0, yaw0) => {
      const s = s0 ?? r.scale[0] + rnd() * (r.scale[1] - r.scale[0]);
      const sy = s * (r.stretch[0] + rnd() * (r.stretch[1] - r.stretch[0]));
      const yaw = yaw0 ?? rnd() * Math.PI * 2, co = Math.cos(yaw), si = Math.sin(yaw);
      const o = n * 16;
      m[o] = co * s; m[o + 1] = 0; m[o + 2] = -si * s; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = si * s; m[o + 9] = 0; m[o + 10] = co * s; m[o + 11] = 0;
      m[o + 12] = lx; m[o + 13] = h - r.sink * s; m[o + 14] = lz; m[o + 15] = 1;
      const jt = r.tintJitter;
      let tr = 1 - jt / 2 + rnd() * jt, tg = 1 - jt / 2 + rnd() * jt, tb = 1 - jt / 2 + rnd() * jt;
      const pick = rnd(); let acc = 0;
      for (const t of r.tints) { acc += t.chance; if (pick < acc) { tr = t.color[0]; tg = t.color[1]; tb = t.color[2]; break; } }
      c[n * 3] = tr; c[n * 3 + 1] = tg; c[n * 3 + 2] = tb;
      if (r.collider) { k[n * 3] = ox + lx; k[n * 3 + 1] = oz + lz; k[n * 3 + 2] = r.collider * s; }
      ids[n] = id;
      n++;
    };
    if (listed) for (const i of listed) {
      const p = rule.positions[i], wx = p[0], wz = p[1];
      rnd.seed(SEED ^ Math.imul(r.salt + 1, 40503) ^ Math.imul(i + 1, 0x9E3779B1));   // per entry, not per chunk: an entry looks the same whichever chunk size
      if (skip?.(wx, wz)) continue;
      const h = surface(wx, wz);
      if (!Number.isFinite(h)) continue;   // off a shaped terrain's outline: no ground to stand on
      put(i, wx - ox, wz - oz, h, p[2] ?? null, p[3] ?? null);   // stable id: the index in rule.positions
    }
    else for (let a = 0; a < attempts; a++) {
      rnd.seed(base ^ Math.imul(a + 1, 0x9E3779B1));
      const lx = rnd() * CHUNK, lz = rnd() * CHUNK, wx = ox + lx, wz = oz + lz;
      if (skip?.(wx, wz)) continue;   // dug, raised or painted ground: what grew there is gone
      const roll = rnd();
      if (r.cluster !== 'none') {
        const f = fbm(wx * 0.008 + 9, wz * 0.008 - 4, 3);
        let t = Math.min(1, Math.max(0, (f - 0.38) / 0.24));
        if (r.cluster === 'meadow') t = 1 - t;
        if (roll > t * t * 0.9 + 0.03) continue;
      } else if (roll > (r.chance ?? 1)) continue;
      const h = surface(wx, wz), sl = slope(wx, wz);
      if (!Number.isFinite(h) || h < r.minHeight || h > r.maxHeight || sl > r.maxSlope) continue;   // a provider's -Infinity is no ground: a plant there is a NaN matrix
      if (r.biomes) { const b = typeAt(wx, wz, h, sl); const w = r.biomes[b]; if (!w || rnd() > w) continue; }
      if (r.avoidFlat && flat?.(wx, wz)) continue;
      put(a, lx, lz, h, null, null);   // stable id: attempt index. Independent of density under one seed (density only sets how many attempts), felled-tree records rely on it
    }
    return { m: m.slice(0, n * 16), c: c.slice(0, n * 3), k: k.slice(0, r.collider ? n * 3 : 0), ids: ids.slice(0, n), n };
  };
}
