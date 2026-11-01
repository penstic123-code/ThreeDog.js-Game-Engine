// Static checks of a merged style (what styleFrom makes of style: [a, b, {...}]); pure functions, no browser.
// Each finding: { level: 'error' | 'warn', path, msg, fix? }. The key list comes from types/style.d.ts (schema.mjs); the world-state rule mirrors
// core/styleParts.js WORLD (which only throws in a dev run) so the same mistake is found before the game starts.
// Not provable here: that a pack holds no gameplay logic (functions are opaque); R34 covers the patterns it can see by text.
import { childOf } from './schema.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const f = (level, path, msg, fix) => ({ level, path, msg, ...(fix && { fix }) });
const didYou = (name, list, closest) => { const c = closest(name, list); return c ? ` Did you mean '${c}'?` : ''; };

// World state a style must not carry (same table as core/styleParts.js): [path, is-world-key, where it goes]
const WORLD = [
  ['water', k => ['level', 'sea', 'size'].includes(k), 'engine.use(water({ level, sea, size }))'],
  ['terrain.config', k => !['shading', 'colorResolution', 'normals', 'normalFn'].includes(k),
    "terrain({ seed, chunkSize, resolution, diagonal, waterLevel, height... }); only shading, colorResolution, normals, normalFn are looks"],
];
// Top-level names that look like world rules, to say so instead of just "unknown"
const WORLDISH = ['waterLevel', 'seed', 'chunkSize', 'gravity', 'hoursPerDay', 'spawn', 'mapSize', 'level', 'sea'];

/** Values of obj at a dotted pattern, '*' matching every key / index: yields [path, value] */
function* at(obj, pattern, base = '') {
  const [head, ...rest] = pattern.split('.');
  if (obj === null || typeof obj !== 'object') return;
  for (const k of head === '*' ? Object.keys(obj) : [head]) {
    if (!(k in obj)) continue;
    const p = base ? `${base}.${k}` : k;
    if (rest.length) yield* at(obj[k], rest.join('.'), p); else yield [p, obj[k]];
  }
}

// ── unknown fields ─────────────────────────────────────────
function unknownFields(style, schema, closest, worldPaths) {
  const out = [];
  (function go(value, spec, path) {
    if (!plain(value)) return;
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (spec.keys.has(k)) { const c = childOf(schema, spec, k); if (c) go(v, c, p); continue; }
      if (spec.open || worldPaths.has(p)) continue;
      if (!path && WORLDISH.includes(k)) {
        out.push(f('error', p, `'${k}' is world state, not a look: swapping the style would change the map or the rules`,
          'put it where the world is made (water({...}), terrain({...}), sky({ hoursPerDay }))'));
        continue;
      }
      out.push(f('error', p, `unknown style field '${k}'.${didYou(k, spec.keys, closest)}`, `allowed here: ${[...spec.keys].join(', ')} (types/style.d.ts)`));
    }
  })(style, schema.interfaces.Style, '');
  return out;
}

function worldFields(style) {
  const out = [], paths = new Set();
  for (const [path, isWorld, where] of WORLD) {
    const obj = path.split('.').reduce((o, k) => o?.[k], style);
    if (!plain(obj)) continue;
    for (const k of Object.keys(obj)) if (isWorld(k)) {
      paths.add(`${path}.${k}`);
      out.push(f('error', `${path}.${k}`, `world state, not a look: swapping the style would change the map or the rules`, `set it with ${where}`));
    }
  }
  return { out, paths };
}

// ── colors ─────────────────────────────────────────────────
const COLOR_PATHS = ['background', 'sky.backdrop', 'palette.*', 'terrain.colors.*', 'sky.moonColor', 'sky.groundTint', 'sky.clouds.color', 'sky.clouds.shade',
  'weather.overcastColor', 'weather.rain.color', 'weather.snow.color', 'weather.snow.cover.foliage', 'weather.snow.cover.ground', 'water.color', 'water.specular', 'water.depthColor.shallow', 'water.depthColor.deep', 'water.foam.color', 'seasons.*.foliage', 'seasons.*.ground',
  'pickup.color', 'character.colors.*', 'triggers.debugColor', 'grid.ok', 'grid.bad', 'grid.tiles.*.*', 'particles.*.color', 'materials.*.color'];
const UI_COLORS = ['bg', 'fg', 'muted', 'accent', 'good', 'line', 'loadingBg', 'fadeBg', 'hudBg', 'hudFg', 'hudAccent'];
const CSS_FN = /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|var)\(/i;

/** Why a color value is wrong (null when fine). css: CSS-only forms (alpha hex, rgb()) allowed, as in style.ui */
export function colorProblem(v, css = false) {
  if (typeof v === 'number') return !Number.isInteger(v) || v < 0 || v > 0xffffff ? `${v} is not a 0xRRGGBB number (integer from 0 to 0xffffff)` : null;
  if (typeof v === 'string') {
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return null;
    if (css && (CSS_FN.test(v) || /^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(v))) return null;
    if (/^[0-9a-f]{6}$/i.test(v)) return `'${v}' lacks the leading # (write '#${v}' or 0x${v})`;
    if (/^0x[0-9a-f]+$/i.test(v)) return `'${v}' is a string; write it as the number ${v}`;
    if (/^#[0-9a-f]+$/i.test(v)) return `'${v}' has ${v.length - 1} hex digits; use 3 or 6${css ? ' (4 or 8 with alpha)' : ''}`;
    if (/^[a-z]+$/i.test(v)) return null;   // a CSS color name: not verifiable here
    return `'${v}' is not a color (use 0xRRGGBB, '#rrggbb'${css ? ", 'rgba(...)'" : ''} or a CSS name)`;
  }
  if (v && typeof v === 'object' && v.isColor) return null;
  return `${Array.isArray(v) ? 'a list' : typeof v} is not a color`;
}
const colorsOf = v => (Array.isArray(v) ? v : [v]);

function colors(style) {
  const out = [], seen = (p, v, css) => {
    for (const c of colorsOf(v)) { const why = colorProblem(c, css); if (why) out.push(f('error', p, `bad color: ${why}`)); }
  };
  for (const pat of COLOR_PATHS) for (const [p, v] of at(style, pat)) {
    const skip = pat === 'materials.*.color' && !plain(style.materials[p.split('.')[1]]);
    if (v !== undefined && v !== null && typeof v !== 'function' && !skip) seen(p, v, false);   // a function (sky.backdrop) is checked when it runs
  }
  for (const k of UI_COLORS) { const v = style.ui?.[k]; if (v !== undefined && v !== null) seen(`ui.${k}`, v, true); }
  (style.sky?.keyframes ?? []).forEach((kf, i) => {
    const p = `sky.keyframes[${i}]`;
    if (!Array.isArray(kf) || kf.length !== 6) {
      const got = Array.isArray(kf) ? kf.length : typeof kf;
      out.push(f('error', p, `a keyframe is [time, zenith, horizon, sunColor, sunIntensity, ambientIntensity] (6 entries), got ${got}`));
      return;
    }
    if (typeof kf[0] !== 'number' || kf[0] < 0 || kf[0] > 1) out.push(f('error', `${p}[0]`, 'time of day must be a number from 0 to 1'));
    const prev = style.sky.keyframes[i - 1]?.[0];
    if (i && typeof kf[0] === 'number' && typeof prev === 'number' && kf[0] <= prev) out.push(f('warn', `${p}[0]`, 'keyframe times should increase'));
    [1, 2, 3].forEach(j => seen(`${p}[${j}]`, kf[j], false));
    [4, 5].forEach(j => { if (typeof kf[j] !== 'number') out.push(f('error', `${p}[${j}]`, 'intensity must be a number')); });
  });
  return out;
}

// ── palette keys ───────────────────────────────────────────
/** Palette keys the pack's generators read (`pal(this).x`, `const c = pal(this)` then `c.x`, `this.palette.x`, `PALETTE.x`), found by text */
export function paletteRefs(source) {
  const refs = new Map(), code = source.split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const add = (k, i) => { if (!refs.has(k)) refs.set(k, code.slice(0, i).split('\n').length); };
  for (const m of code.matchAll(/(?:\bthis\??\.palette|\bctx\??\.palette|\bPALETTE|\bpal\([^)]*\))\??\.([A-Za-z_$][\w$]*)/g)) add(m[1], m.index);
  for (const a of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:pal\([^)]*\)|this\.palette)\s*[,;\n]/g))
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${a[1]}\\.([A-Za-z_$][\\w$]*)`, 'g'))) add(m[1], m.index);
  return refs;
}
function paletteKeys(style, refs, closest) {
  const have = Object.keys(style.palette ?? {}), out = [];
  for (const [k, line] of refs) if (!have.includes(k)) {
    out.push(f('error', `palette.${k}`, `a generator reads palette.${k} (${line}) but style.palette does not define it.${didYou(k, have, closest)}`,
      `add ${k}: 0x... to palette`));
  }
  return out;
}

// ── post effects ───────────────────────────────────────────
const SLOTS = ['scene', 'hdr', 'ldr', 'final'];
const MAX_POST = 2;
function post(style) {
  const list = style.post, out = [];
  if (list === undefined) return out;
  if (!Array.isArray(list)) return [f('error', 'post', 'style.post must be an array of post effects, e.g. post: [bloom()]')];
  const names = new Map(), eff = [];
  list.forEach((e, i) => {
    const p = `post[${i}]`;
    if (!plain(e) || typeof e.name !== 'string') { out.push(f('error', p, "a post effect is { name, slot, order, create(ctx) } (or a fuse snippet); this one has no name")); return; }
    if (names.has(e.name)) out.push(f('error', p, `two post effects are named '${e.name}' (also post[${names.get(e.name)}]): the engine refuses a second one`, `rename one, or use postAdd(effect) to replace by name`));
    names.set(e.name, i);
    const slot = e.slot ?? 'hdr';
    if (!SLOTS.includes(slot)) out.push(f('error', p, `effect '${e.name}': unknown slot '${slot}'`, `use ${SLOTS.join(' | ')}`));
    if (typeof e.create !== 'function' && !e.fuse) out.push(f('error', p, `effect '${e.name}' has neither create(ctx) nor a fuse snippet`));
    if (e.fuse && slot === 'scene') out.push(f('error', p, `effect '${e.name}': a fuse snippet cannot replace the scene render`, "use slot 'hdr' | 'ldr' | 'final'"));
    eff.push({ ...e, slot, order: e.order ?? 0, i });
  });
  const scene = eff.filter(e => e.slot === 'scene');
  if (scene.length > 1) out.push(f('error', 'post', `post slot 'scene' can hold one effect, found ${scene.map(e => `'${e.name}'`).join(', ')}`, 'only one effect may replace the scene render'));
  // needsDepth: the depth lives only in the buffer the scene render wrote, so nothing that swaps buffers may run before the reader.
  // Statically a swap is certain for a scene-slot effect, a fuse group (one ShaderPass) and anything after tone mapping (ldr / final).
  const chain = SLOTS.flatMap(s => eff.filter(e => e.slot === s).sort((a, b) => a.order - b.order || a.i - b.i));
  let swapped = null;
  for (const e of chain) {
    const on = e.enabled !== false;
    if (e.needsDepth && swapped && on) out.push(f('error', `post[${e.i}]`, `'${e.name}' reads scene depth (needsDepth) but runs after '${swapped}', which swaps buffers`, `give '${e.name}' a lower order or an earlier slot than '${swapped}'`));
    if (e.needsDepth && (e.slot === 'ldr' || e.slot === 'final')) out.push(f('error', `post[${e.i}]`, `'${e.name}' reads scene depth but sits in slot '${e.slot}', after tone mapping`, "use slot 'hdr'"));
    if (on && (e.slot === 'scene' || e.fuse)) swapped ??= e.name;
  }
  // dof copies the scene depth into its output, so an outline after it works (crisp lines over the blur); dof after an outline would find no scene depth
  const dof = chain.find(e => e.name === 'dof' && e.enabled === true), line = chain.find(e => e.name === 'outline' && e.enabled === true);
  if (dof && line && chain.indexOf(dof) > chain.indexOf(line)) out.push(f('error', `post[${dof.i}]`, "'dof' runs after 'outline' (both on): outline swaps buffers, so dof would not find the scene depth",
    `give 'dof' a lower order than 'outline' (dof ${dof.order} -> below ${line.order}); both can be on, lines then stay sharp over the blur`));
  // More effects stacked rarely means closer to a reference: each one adds its own look, and the sum drifts away from the picture
  const on = eff.filter(e => e.enabled !== false);
  if (on.length > MAX_POST) out.push(f('warn', 'post', `${on.length} post effects are on (${on.map(e => `'${e.name}'`).join(', ')}); more than ${MAX_POST}`, 'Do not add effects the reference picture does not show; more effects make it worse. Turn them off until only the necessary ones remain'));
  return out;
}

// ── materials and asset names ──────────────────────────────
function materials(style, schema, purposes, closest) {
  const out = [];
  for (const [role, spec] of Object.entries(style.materials ?? {})) {
    if (!purposes.includes(role)) {
      const c = closest(role, purposes);
      if (c) out.push(f('warn', `materials.${role}`,
        `'${role}' is not an engine material role; did you mean '${c}'? (roles: ${purposes.join(', ')}; your own names are fine if code asks for them)`));
    }
    if (plain(spec) && spec.type !== undefined && !schema.materialTypes.includes(spec.type))
      out.push(f('error', `materials.${role}.type`, `unknown material type '${spec.type}'.${didYou(spec.type, schema.materialTypes, closest)}`, `use ${schema.materialTypes.join(' | ')}`));
  }
  return out;
}

const MATERIAL_TEXTURES = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'displacementMap', 'lightMap',
  'specularMap', 'detail.texture'];
const isPath = s => /[\\/]|\.\w{2,5}$/.test(s);
function assetRefs(style, assets, closest) {
  const out = [], refs = [['character.model', 'models'], ['sky.skybox', 'textures'], ['terrain.detail.texture', 'textures'], ['water.normalMap', 'textures'],
    ['weather.rain.texture', 'textures'], ['weather.snow.texture', 'textures'],
    ...MATERIAL_TEXTURES.map(k => [`materials.*.${k}`, 'textures'])];
  for (const [pat, kind] of refs) for (const [p, v] of at(style, pat)) if (typeof v === 'string' && !isPath(v)) check(p, v, kind);
  (style.ui?.fonts ?? []).forEach((n, i) => { if (typeof n === 'string') check(`ui.fonts[${i}]`, n, 'fonts'); });
  for (const [p, v] of at(style, 'ui.font')) if (typeof v === 'string' && /\.(woff2?|ttf|otf)\b|url\(/i.test(v)) {
    out.push(f('error', p, 'a style never holds a font file',
      "register it in an asset pack (manifest({ fonts: { name: 'file' } })) and list the name in ui.fonts"));
  }
  return out;
  function check(p, name, kind) {
    const known = [...(assets[kind] ?? [])];
    if (known.includes(name)) return;
    const has = known.length ? ` (it has: ${known.join(', ')})` : '';
    out.push(f('warn', p, `${kind.slice(0, -1)} asset '${name}' is not in this pack's asset pack${has}.${didYou(name, known, closest)}`,
      'fine if the game registers it (engine.assets.manifest); pass --assets <file> to check against another pack'));
  }
}

/**
 * All checks on a merged style.
 * @param {object} style  the result of styleFrom(style)
 * @param {{ schema: any, closest: Function, purposes: string[], assets?: Record<string, Set<string>|string[]>, paletteRefs?: Map<string, number> }} ctx
 */
export function checkStyle(style, ctx) {
  const { schema, closest, purposes, assets = {}, paletteRefs: refs = new Map() } = ctx;
  const w = worldFields(style);
  return [...w.out, ...unknownFields(style, schema, closest, w.paths), ...paletteKeys(style, refs, closest), ...colors(style), ...post(style),
    ...materials(style, schema, purposes, closest), ...assetRefs(style, assets, closest)];
}
