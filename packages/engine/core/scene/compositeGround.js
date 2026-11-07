// compositeGround({ parts }): one module that holds the exclusive 'ground' slot and answers each query from the part whose region contains the point,
// so a terrain island and a hand-made level (or several levels) coexist without a second ground path. Parts are modules installed with { part: true }
// (terrain({ part: true }), level({ part: true })): they give their provider as module.ground instead of taking the slot.
//   parts: [{ of: 'terrain' | 'level', region?, priority? }]  (or { ground: provider } for a provider object you made)
//   region: omitted = everywhere | (x, z) => boolean | { volume } (the plain volume water and triggers take, asked at y 0: a region has no height). Higher priority wins where regions overlap (default 0, then list order)
import { flatGround } from './ground.js';
import { codedError } from '../base/errorHints.js';
import { keysSchema } from '../base/params.js';

const PARAMS = keysSchema(['parts']);
const bad = msg => codedError('module-params', 'compositeGround: ' + msg);
const inRegion = r => {
  if (r == null) return () => true;
  if (typeof r === 'function') return r;
  if (typeof r.volume?.contains === 'function') { const p = { x: 0, y: 0, z: 0 }; return (x, z) => { p.x = x; p.z = z; return r.volume.contains(p); }; }
  throw bad('region must be a function (x, z) => boolean or { volume: { contains({ x, y, z }) } }');
};

export function compositeGround(opts = {}) {
  const list = opts.parts;
  if (!Array.isArray(list) || !list.length) throw bad('pass { parts }: a non-empty list of { of: "terrain" | "level", region?, priority? }');
  for (const p of list) if (!p.of && !p.ground) throw bad('every part needs of: "terrain" | "level" (a module installed with { part: true }) or ground: provider');
  const requires = [...new Set(list.map(p => p.of).filter(Boolean))];
  return {
    name: 'compositeGround', type: 'world', provides: ['ground'], requires, stage: 'ground', label: 'Composite ground', options: opts, params: PARAMS,
    install(engine, ctx) {
      const parts = list.map((p, i) => {
        const g = p.ground ?? engine[p.of]?.ground;
        if (!g) throw bad(`engine.${p.of} gave no ground; install it with ${p.of}({ part: true })`);
        return { g: { ...flatGround, ...g }, in: inRegion(p.region), priority: p.priority ?? 0, i };
      }).sort((a, b) => b.priority - a.priority || a.i - b.i);
      // the part answering at a point: first (by priority) whose region has it and that has ground there; else the last part, so a query always answers
      const at = (x, z) => { for (const p of parts) if (p.in(x, z) && p.g.has(x, z)) return p.g; return parts[parts.length - 1].g; };
      const first = k => parts.find(p => p.g[k] != null)?.g[k];
      const out = {
        height: (x, z, refY) => at(x, z).height(x, z, refY),
        slope: (x, z, refY) => at(x, z).slope(x, z, refY),
        type: (x, z, refY) => at(x, z).type(x, z, refY),
        water: (x, z, refY) => { const g = at(x, z); return g.water ? g.water(x, z, refY) : g.waterLevel; },
        waterLevel: Math.max(...parts.map(p => p.g.waterLevel)),
        has: (x, z) => parts.some(p => p.in(x, z) && p.g.has(x, z)),
        // a part with no void (a level, -Infinity) must not hide the part that has one
        voidY: () => { const ys = parts.map(p => p.g.voidY()).filter(Number.isFinite); return ys.length ? Math.min(...ys) : -Infinity; },
        forEachCollider: (x, z, range, fn) => { for (const p of parts) p.g.forEachCollider?.(x, z, range, fn); },
      };
      for (const k of ['chunkSize', 'viewRange']) if (first(k) != null) out[k] = first(k);
      // physics asks like every other query: a part gives triangles only where it answers, or a terrain's hills stand invisible and solid inside a level's region.
      // A triangle stays when any corner is the part's own, so no hole opens along a region's edge. Worked out once per chunk version and level version.
      const solid = parts.find(p => p.g.chunkCollision)?.g, cut = new WeakMap();
      const own = ({ positions: p, ox, oz }) => {
        const kept = new Float32Array(p.length); let n = 0;
        for (let i = 0; i < p.length; i += 9) {
          if (at(ox + p[i], oz + p[i + 2]) !== solid && at(ox + p[i + 3], oz + p[i + 5]) !== solid && at(ox + p[i + 6], oz + p[i + 8]) !== solid) continue;
          kept.set(p.subarray(i, i + 9), n); n += 9;
        }
        return n === p.length ? p : kept.subarray(0, n);
      };
      if (solid) out.chunkCollision = (cx, cz) => {
        const data = solid.chunkCollision(cx, cz); if (!data) return data;
        const version = out.staticVersion?.() ?? 0;
        let c = cut.get(data.token);
        if (c?.version !== version) cut.set(data.token, c = { version, token: {}, positions: own(data) });
        return { ...data, token: c.token, positions: c.positions };
      };
      if (parts.some(p => p.g.staticTrimeshes)) {
        out.staticTrimeshes = () => parts.flatMap(p => p.g.staticTrimeshes?.() ?? []);
        out.staticVersion = () => parts.reduce((n, p) => n + (p.g.staticVersion?.() ?? 0), 0);
      }
      ctx.ground.provide(out);
    },
  };
}
