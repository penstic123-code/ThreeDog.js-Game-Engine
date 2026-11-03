// describe().look, catalog('look.*').
// Both read the same layer records (part.js), so "who set this"
// in describe and "what can I set" in the catalog cannot disagree. Values set straight on the three.js object (renderer.toneMappingExposure = 2)
// show up as writer: 'three': the part's read() returns the live value and it no longer matches what the layers say.
// One field answers "who set it": `writer`, the same name describe().owned and describe().render use, so a tool reads one key everywhere.
// It is the look layer that set the value ('style', 'game', 'game:cave', 'debug:probe'), unless something else writes the property now: then that
// writer wins ('three' for a direct three.js write, 'manual:game' / 'three (engine yielded)' from describe().owned), because that is what is on screen.
import { schemaInfo } from '../params.js';
import { rv } from '../math.js';
import { ownedOf } from '../owned.js';
import { stylePackOf } from '../styleParts.js';

const shown = v => (typeof v === 'number' ? rv(v) : typeof v === 'function' ? '<function>' : Array.isArray(v) && v.length > 4 ? `<array of ${v.length}>` : v?.isObject3D || v?.isTexture || v?.isMaterial ? `<${v.type}>` : v);
/**
 * Same value for the 'three' check: numbers within a small tolerance, arrays / Colors / vectors element by element. Why: the live read
 * (a Color, a Vector2) is a different object from the layer value ([0.012, 0.006], '#fff'), and !== tagged it 'three' (review L5)
 */
function same(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  const arr = v => (Array.isArray(v) ? v : v?.isColor ? [v.r, v.g, v.b] : typeof v?.toArray === 'function' ? v.toArray() : null);
  const x = arr(a), y = arr(b);
  if (x && y) return x.length === y.length && x.every((v, i) => same(v, y[i]));
  const c = a?.isColor ? a : b?.isColor ? b : null, other = c === a ? b : a;
  // 'horizon' and the like are not colors: three would warn
  if (c && (typeof other === 'number' || /^(#|rgb|hsl)/i.test(other ?? ''))) return c.clone().set(other).equals(c);
  return false;
}
/** A layer as a writer name: 'game' | 'style' | 'engine' | 'settings' (owner named like its layer) | '<layer>:<owner>' (owner as given to set / debug.override) */
const tag = (s) => s.owner === s.layer || s.layer === 'style' || s.layer === 'engine' ? s.layer : `${s.layer}:${s.owner}`;

/** One part's keys: { key: { value, writer, at?, under? } }; under lists the layers this value covers (top first) */
function partInfo(p) {
  const live = p._spec.read?.() ?? {}, out = {}, owned = ownedOf(p._e, p._spec.id);
  for (const k of p._keys()) {
    const s = p._source(k);
    if (!s) continue;
    const o = { value: shown(s.value), writer: tag(s) };
    // a driver (the sky) writes it every frame from the layered value: the live value is what is on screen, whoever is on top (a debug override
    // shows on the next frame; while paused the live value is the last one drawn)
    if (s.driver) Object.assign(o, { value: shown(live[k]), driver: s.driver });
    else if (k in live && live[k] !== undefined && !same(live[k], s.value)) Object.assign(o, { value: shown(live[k]), writer: 'three' });
    if (s.at) o.at = s.at;
    // several packs merged into the style: name the one this value came from (styleParts.js records the source per path while merging)
    if (s.layer === 'style' && !s.driver && o.writer === 'style') { const pack = stylePackOf(p._e.style, k, s.value); if (pack) o.pack = pack; }
    if (s.layer === 'engine' && o.writer === 'engine' && p._meta[k]?.device) o.why = p._meta[k].device;   // the engine chose this for the device (layers.js LOOK_FIELDS)
    if (s.under.length && s.layer !== 'engine') o.under = s.under.map(tag);
    // who writes it now (core/owned.js) when the engine yielded it: the owned row's name wins over the plain 'three' guess (yielded / manual:<who>)
    const w = owned.find(x => !x.on && (x.key === k || k.startsWith(x.key + '.')));
    if (w) o.writer = w.info().writer;
    // a function value that threw or gave a non-number (points.js evalFn): how many evaluations failed, and the last reason; the value is the last good one
    for (const f of p._fns.values()) if (f.key === k && f.errors) { o.fnErrors = (o.fnErrors ?? 0) + f.errors; o.fnError = `${f.owner}: ${f.lastError}`; }
    out[k] = o;
  }
  return Object.assign(out, p._spec.info?.());   // read-only rows that are not params (look.env source), same { value, writer } shape
}

/** describe().look: { <part>: { key: { value, writer } }, text } (undefined when no part is registered) @param {any} e */
export function describeLook(e) {
  const parts = Object.values(e.look ?? {});
  if (!parts.length) return undefined;
  const out = {}, lines = [];
  for (const p of parts) {
    const info = out[p._spec.id] = partInfo(p);
    lines.push(`${p._spec.id}${p._spec.appliesTo ? ` (applies to ${p._spec.appliesTo})` : ''}:${Object.entries(info).map(([k, v]) => `${k}=${typeof v.value === 'object' && v.value ? JSON.stringify(v.value) : v.value} (${v.writer})`).join(' ')}`);
  }
  return { ...out, text: lines.join('\n') };
}

/** One part as catalog data: params (schema + why / off / cost + value in use and its source), hooks, replace contract, verbs */
function lookEntry(e, p) {
  const s = p._spec, schema = schemaInfo(p._params), info = partInfo(p);
  for (const k in schema) {
    const m = p._meta[k];
    for (const f of ['why', 'off', 'cost']) if (m[f] !== undefined) schema[k][f] = m[f];
    if (m.neutral) schema[k].neutral = true;
    if (info[k]) Object.assign(schema[k], { value: info[k].value, writer: info[k].writer });
  }
  return { id: p.id, kind: 'look', group: s.group ?? null, module: s.module ?? 'core', verbs: verbsOf(p), signatures: p.author.signatures, params: schema,
    ...(s.appliesTo ? { appliesTo: s.appliesTo } : {}),
    hooks: s.hooks ?? null, replace: s.replace ?? null, ...(s.docs ? { docs: s.docs } : {}), problems: [] };
}
// the verbs a part has: the keys of its signatures, so the catalog's verb list and its call shapes come from one place
const verbsOf = p => Object.keys(p.author.signatures);

/** Short list rows for engine.catalog() (same row shape as modules: ops / saves stay empty) @param {any} e */
export function lookSummaries(e) {
  return Object.values(e.look ?? {}).map(p => ({ id: p.id, kind: 'look', group: p._spec.group ?? null, module: p._spec.module ?? 'core', verbs: verbsOf(p), ops: [], saves: [] }));
}

/** engine.catalog('look') -> every part expanded; 'look.<part>' -> that part; else null @param {any} e @param {string} id */
export function lookCatalog(e, id) {
  if (id === 'look') return Object.values(e.look ?? {}).map(p => lookEntry(e, p));
  const p = e.look?.[id.slice(5)];
  return p ? lookEntry(e, p) : null;
}
