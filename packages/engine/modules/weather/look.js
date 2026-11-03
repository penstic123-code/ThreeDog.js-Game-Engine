// look.weather: rain / snow particles, lightning flash and the overcast color as a look part (recipes/52-look.md).
//   set({ 'rain.color', 'rain.speed', 'snow.size', 'lightning.brightness', overcastColor ... })   rebuilds that field's particle system once (a few ms)
//   patch('rain.vertex' | 'rain.fragment' | 'snow.vertex' | 'snow.fragment', glsl)             the WHOLE shader text, not a function (see shaders.js)
//   replace({ rain: spec, ash: spec })   spec = the keys of style.weather.rain or { create(engine, { area, count }) => { object, update } }; null gives back
// Why the shader stays whole (decision #9): the rain / snow shaders move vertices and size points; a function hook would hide most of that.
import { defineLookPart, REPLACE } from '../../core/look/part.js';
import { warnOnce } from '../../core/validate.js';
import { RAIN, SNOW, dropSystem } from './particles.js';

const WHY = { rain: 'built-in rain: streaks drawn while a weather type has rain > 0', snow: 'built-in snow: flakes drawn while a weather type has snow > 0' };
const OFF = { rain: "leave 'rain' out of the weather table (no particles are built), or look.weather.set({ 'rain.opacity': 0 })", snow: "leave 'snow' out of the weather table, or look.weather.set({ 'snow.opacity': 0 })" };
const KEYS = { rain: ['color', 'opacity', 'length', 'speed', 'slant'], snow: ['color', 'opacity', 'size', 'speed', 'sway'] };
const BASE = { rain: RAIN, snow: SNOW };
const FIELDS = ['rain', 'snow'], STAGES = ['vertex', 'fragment'];

/** { 'rain.color': { type, default, why, off } ... } built from the particle defaults, so the numbers live in one place (particles.js) */
const rows = () => Object.fromEntries(FIELDS.flatMap(f => KEYS[f].map(k => [`${f}.${k}`,
  { type: k === 'color' ? 'any' : 'number', default: BASE[f][k], ...(k === 'color' ? {} : { min: 0 }), cost: 'gpu', why: WHY[f], off: OFF[f] }])));

/** @param {any} w the Weather module */
export function defineWeatherLook(w) {
  const e = w.engine, st = e.style.weather ?? {}, { cover, ...snowStyle } = st.snow ?? {};
  const styleSpec = f => (f === 'snow' ? snowStyle : st[f] ?? {});
  let applied = {};   // fields a replace() holds now: field -> spec
  const rebuild = f => {
    if (applied[f]) return;   // replace() owns this field
    if (!w.systems.has(f)) { warnOnce(`look.weather: this game's weather table has no ${f}, so there are no ${f} particles to change; add a type with ${f}: 1 to weather({ types })`); return; }
    const v = p.author.values(), s = styleSpec(f), g = { ...s.glsl };
    for (const h of STAGES) { const x = p.value(`hook:${f}.${h}`); if (x) g[h] = x; }
    w._build(f, { ...s, ...Object.fromEntries(KEYS[f].map(k => [k, v[`${f}.${k}`]])), ...(Object.keys(g).length ? { glsl: g } : {}) }, BASE[f]);
  };
  const p = defineLookPart(e, {
    id: 'weather', group: 'dynamic', module: 'weather', object: () => w.systems, docs: ['recipes/52-look.md'], applyAtStart: false,
    params: {
      ...rows(),
      'lightning.brightness': { type: 'number', default: 1, min: 0, neutral: true, cost: 'uniform', desc: 'how bright the sky flashes at a strike' },
      overcastColor: { type: 'any', default: 0x8c8c8c, cost: 'uniform', why: 'sky and fog turn this gray as a weather type raises grey', off: 'weather types with grey: 0 never use it' },
    },
    style: () => ({
      ...Object.fromEntries(FIELDS.flatMap(f => KEYS[f].filter(k => styleSpec(f)[k] !== undefined).map(k => [`${f}.${k}`, styleSpec(f)[k]]))),
      ...Object.fromEntries(FIELDS.flatMap(f => STAGES.filter(h => styleSpec(f).glsl?.[h]).map(h => [`hook:${f}.${h}`, styleSpec(f).glsl[h]]))),
      'lightning.brightness': st.lightningBrightness, overcastColor: st.overcastColor,
    }),
    read: () => ({}),
    apply(v, changed) {
      if (changed.has('lightning.brightness')) w.flashStrength = v['lightning.brightness'];
      if (changed.has('overcastColor')) w.grey.set(v.overcastColor);
      for (const f of FIELDS) if ([...changed].some(k => k.startsWith(f + '.'))) rebuild(f);
    },
    hooks: Object.fromEntries(FIELDS.flatMap(f => STAGES.map(h => [`${f}.${h}`, { signature: 'whole GLSL shader text (copy it from modules/weather/shaders.js)', scope: ['uCam', 'uSize', 'uFallOff', 'uOpacity', 'uColor'] }]))),
    applyHook(name) { rebuild(name.split('.')[0]); },
    replace: { accepts: '{ <field>: spec } with spec = the keys of style.weather.rain, or { create(engine, { area, count }) => { object, update?(amount, ctx) } }; null gives the fields back',
      loses: ['the style rain / snow look of every field named in the object (look.weather.set values for it are ignored while it holds)'] },
    // a wrong replace value stops here, before any layer is written (the throw used to come from applyReplace, after the write)
    validate: (k, v) => {
      if (k !== REPLACE) return null;
      if (v != null && (typeof v !== 'object' || Array.isArray(v))) return "is { <field>: spec }, e.g. replace({ ash: { shape: 'soft', color: 0x555555 } }); see recipes/44-water-weather-look-hooks.md";
      const fields = [...new Set(Object.values(w.types).flatMap(t => Object.keys(t)))], bad = Object.keys(v ?? {}).find(f => !fields.includes(f));
      return bad ? `no weather type has a field '${bad}'; add it to a type in weather({ types }) (e.g. ashfall: { ${bad}: 1 }), or use one of ${fields.join(', ')}` : null;
    },
    applyReplace(impl) {
      const next = impl ?? {}, old = applied;
      applied = next;
      for (const f of new Set([...Object.keys(old), ...Object.keys(next)])) {
        if (next[f] && next[f] === old[f]) continue;   // unchanged: keep the system (and any handle the game holds)
        if (next[f]) w._build(f, next[f], BASE[f]);
        else if (BASE[f]) rebuild(f);
        else { const s = w.systems.get(f); if (s) { dropSystem(e, s); w.systems.delete(f); } }
      }
    },
  });
  return p;
}

