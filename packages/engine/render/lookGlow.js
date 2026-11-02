// Night glow: emissive following daylight.
// look.materials.glow(match, { night, day, dusk }) for lit windows, neon signs, lamp bulbs, glowing mushrooms, screens.
// Why the engine does it: the game knows WHICH materials glow and how bright; it cannot easily know WHEN a matching material exists. Templates and
// streamed models are built near the player long after startup, so games walked the whole scene on a timer to find them. Here one rule names
// the materials once; only objects that entered the scene since the last frame are looked at (core/sceneDelta.js, shared with the cascades
// and fog), and each frame only the matched materials get one number written, and only when it changed.
// Why a verb on look.materials: a rule is a look value with an owner like the others, so describe().look.materials lists it ('glow:<name>'),
// remove() hands it back (the material gets its own emissiveIntensity again) and the picture's colors stay the game's (emissive is never touched).
import { sceneVisitor } from '../core/sceneDelta.js';
import { warnOnce } from '../core/validate.js';
import { coded } from '../core/errorHints.js';

const KEY = 'glow:';
// default dusk: lights fade in as daylight drops below 0.3 (calendar daylight: about 16:50 -> fully lit at 18:00). It is only a starting value:
// each rule may pass its own `dusk` (signs on earlier than windows, a cave mushroom that only glows in the dark)
// exported with daylightOf / nightOf: lightPool sources with `dusk` (modules/lights) fade on the same curve, so a lamp's real light and its
// window glow switch on together instead of two curves drifting apart
export const DUSK = 0.3;
const SIG = 'glow(match, { night, day = 0, dusk = 0.3, owner })';

/** What a match finds: a role / material name string, one Material, or (material) => boolean */
function matcher(match) {
  if (typeof match === 'string' && match) return { label: match, test: m => m.name === match || m.userData?.purpose === match };
  if (match?.isMaterial) return { label: match.name || `material#${match.id}`, test: m => m === match };
  if (typeof match === 'function') return { label: match.name || 'filter', test: match };
  return null;
}

/** Daylight 0..1: calendar first (gameplay day / night), else the drawn sun; null when nothing tells day from night */
export const daylightOf = e => { const d = e.calendar?.daylight ?? e.sky?.daylight; return typeof d === 'number' ? d : null; };
/**
 * 0 by day, 1 at night for one rule's dusk (daylight below which it fades in); null daylight -> 0 (the day value is kept). dusk 0 has no fade:
 * on only while daylight is 0 (a cave mushroom that glows only in full dark); the d / dusk curve would divide by zero there
 */
export function nightOf(d, dusk) {
  if (d === null) return 0;
  if (dusk === 0) return d > 0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, d / dusk));
  return 1 - t * t * (3 - 2 * t);   // smoothstep: no visible kink when the fade starts or ends
}
const valueOf = (r, d) => r.day + (r.night - r.day) * nightOf(d, r.dusk);

/**
 * Add the glow verb to the materials look part.
 * @param {any} e @param {any} part engine.look.materials
 */
export function addGlowVerb(e, part) {
  const tests = new Map();   // 'glow:<name>' -> test; the layer value itself stays plain data so describe prints it
  const base = new WeakMap();   // material -> its own emissiveIntensity before a rule touched it (restored when no rule matches it any more)
  // found: material in the scene -> the rule it matched and how many scene objects use it (given back when the count drops to 0);
  // held: object -> the matched materials it counted, so its leave takes back exactly what its enter added
  let found = new Map(), held = new WeakMap(), view = null, frame = null, seq = 0, testsRev = 0;
  // the rules, rebuilt only when the materials part changed (part._rev), not every frame; sig = which keys and tests, so a night / day
  // change rewrites numbers without looking at the scene again
  let rev = -1, sig = '', list = [], byKey = new Map();

  const restore = m => { if (base.has(m)) { m.emissiveIntensity = base.get(m); base.delete(m); } };
  const enter = o => {
    if (!o.isMesh || !o.material) return;
    let mine = null;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const r = list.find(x => x.test?.(m));
      if (!r) continue;
      if (!('emissiveIntensity' in m)) { warnOnce(coded('look-param', `look.materials.glow('${r.key.slice(KEY.length)}'): material '${m.name || m.type}' has no emissive (a ${m.type}); give it an emissive material (MeshStandardMaterial / Lambert / Phong / Toon)`)); continue; }
      if (m.emissive?.getHex?.() === 0) warnOnce(coded('look-param', `look.materials.glow('${r.key.slice(KEY.length)}'): material '${m.name || m.type}' has a black emissive, so it cannot glow; set its color: material.emissive.set('#ffcc66')`));
      if (!base.has(m)) base.set(m, m.emissiveIntensity);
      const f = found.get(m);
      if (f) f.n++; else found.set(m, { key: r.key, n: 1 });
      (mine ??= []).push(m);
    }
    if (mine) held.set(o, mine);
  };
  const leave = o => {
    const mine = held.get(o);
    if (!mine) return;
    held.delete(o);
    for (const m of mine) { const f = found.get(m); if (f && --f.n <= 0) { found.delete(m); restore(m); } }   // out of the scene: its own value back
  };

  function update() {
    if (part._rev !== rev) {
      rev = part._rev;
      // every rule in effect now (layers decide which owner's value wins, as for any look key)
      list = part.resolved(KEY).filter(([, v]) => v).map(([k, v]) => ({ key: k, test: tests.get(k), night: v.night, day: v.day, dusk: v.dusk ?? DUSK }));
      byKey = new Map(list.map(r => [r.key, r]));
      const s = list.map(r => r.key).join('|') + '#' + testsRev;
      if (s !== sig) {
        // which materials match changed: show this visitor the whole scene again, then give back what no rule matches now
        sig = s;
        const old = found;
        found = new Map(); held = new WeakMap();
        if (list.length) { if (view) view.rescan(); else view = sceneVisitor(e.scene, { enter, leave }); view.sync(); }
        for (const m of old.keys()) if (!found.has(m)) restore(m);
      }
    }
    if (!list.length) { view?.remove(); view = null; frame?.remove(); frame = null; return; }
    view.sync();   // only what entered the scene since the last frame (core/sceneDelta.js)
    const d = daylightOf(e);
    if (d === null) { warnOnce(coded('look-param', 'look.materials.glow(): nothing tells day from night, so the day value is kept. Install calendar() (or sky())')); }
    for (const [m, f] of found) {
      const v = valueOf(byKey.get(f.key), d);
      if (m.emissiveIntensity !== v) m.emissiveIntensity = v;
    }
  }

  part.glow = (match, o = {}) => {
    const t = matcher(match);
    if (!t) throw part._lacks('glow', `match is a material role or material name ('window'), a Material, or (material) => boolean; got ${typeof match}`, `Call it as look.materials.${SIG}`);
    const { night, day = 0, dusk = DUSK, owner, ...rest } = o;
    const extra = Object.keys(rest)[0];
    if (extra) throw part._lacks('glow', `unknown option ${extra} (options: night, day, dusk, owner)`, `Call it as look.materials.${SIG}`);
    if (typeof dusk !== 'number' || !(dusk >= 0 && dusk <= 1)) throw part._lacks('glow', `dusk is the daylight (0..1; 0 = only while daylight is 0) below which the glow fades in; got ${JSON.stringify(dusk)}`, `Call it as look.materials.${SIG}`);
    if (typeof night !== 'number' || typeof day !== 'number') throw part._lacks('glow', `night and day are emissiveIntensity numbers, e.g. { night: 2, day: 0 } (an example value: a near-white emissive color clips to white well below it, a saturated one reads as light; judge with threedog shot, docs/recipes/52-look.md "Night glow"); got ${JSON.stringify({ night, day })}`, `Call it as look.materials.${SIG}`);
    // a string names its rule (a second glow('window') replaces the first); a Material / filter gets its own key so two never overwrite each other
    const key = KEY + t.label + (typeof match === 'string' ? '' : `#${++seq}`);
    tests.set(key, t.test); testsRev++;
    const handle = part.write(owner ?? key, { [key]: { night, day, dusk, match: t.label } });
    frame ??= e.onFrame(update);
    update();   // at once: a test or screenshot right after the call sees the value
    // the handle undoes this write only (a second rule under the same owner stays). A Material / filter key is this call's alone, so its test goes too
    // (a string key may still be another owner's rule)
    return { remove() { handle.remove(); if (typeof match !== 'string') { tests.delete(key); testsRev++; } update(); } };
  };
  return {
    /** describe().look.materials rows: per rule, how many materials it found and the intensity written now */
    info() {
      const out = {}, d = daylightOf(e);
      for (const r of list) {
        let n = 0;
        for (const f of found.values()) if (f.key === r.key) n++;
        out[`${r.key}.found`] = { value: `${n} material(s), emissiveIntensity ${Math.round(valueOf(r, d) * 100) / 100} now`, writer: 'engine' };
      }
      return out;
    },
  };
}
