// style tools: `style check` on deliberately wrong styles, `new-style` generating a pack that passes, `style palette` on a generated PNG.
import { mkdtempSync, writeFileSync, rmSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ENGINE, ROOT, styleDir } from '../paths.mjs';
import { loadSchema } from '../style/schema.mjs';
import { checkStyle, paletteRefs, colorProblem } from '../style/check.mjs';
import { createStyle } from '../new-style.mjs';
import { styleCheck } from '../style.mjs';
import { paletteOf } from '../style/palette.mjs';

export const name = 'style tools: check, new-style, palette';

export const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** A PNG of w×h pixels, color(x, y) → [r, g, b] */
export function png(w, h, color) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1); raw[o] = 0; raw.set(color(x, y), o + 1 + x * 3); }
  const chunk = (type, data) => {
    const t = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), c = Buffer.alloc(4);
    len.writeUInt32BE(data.length); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const near = (hex, rgb, tol = 24) => [1, 3, 5].every((i, k) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - rgb[k]) <= tol);

export async function run({ check }) {
  const schema = loadSchema(), { closest } = await import(pathToFileURL(join(ENGINE, 'core', 'validate.js')).href);
  const purposes = ['default', 'terrain', 'vegetation', 'character', 'water', 'pickup', 'prop'];
  const find = (style, ctx = {}) => checkStyle(style, { schema, closest, purposes, ...ctx });
  const has = (list, path, text) => list.some(x => x.path === path && (x.msg + (x.fix ?? '')).includes(text));

  // ── style check ──
  check('schema is read from style.d.ts (Style, sky.shadow and an inline type)', schema.interfaces.Style.keys.has('palette') &&
    schema.interfaces.StyleShadow.keys.has('mapSize') && schema.interfaces.StyleUI.open);
  check('a good style has no findings', find({
    name: 'x', exposure: 1, palette: { a: 0x112233 },
    sky: { sunSize: 900, clouds: { color: '#fff', coverage: 1 }, keyframes: [[0, 0, 0, 0, 1, 1]] },
    materials: { default: { type: 'lambert' } }, ui: { accent: 'rgba(1,2,3,.5)', whatever: 1 },
  }).length === 0);
  // recipes/47 keys: sky.backdrop (color or function), weather.snow.cover (interface extends: the particle keys stay known)
  check('sky.backdrop and weather.snow.cover are known; snow keeps its particle keys', find({ name: 'x', sky: { backdrop: 0xefebe4 },
    weather: { snow: { size: 20, cover: { foliage: 0xf2f4f6, ground: '#eef0f2', strength: 0.8 } } } }).length === 0 &&
    find({ name: 'x', sky: { backdrop: s => (s.isDay ? 0xefebe4 : 0x2c3346) } }).length === 0);
  const bad47 = find({ name: 'x', sky: { backdrop: 'efebe4' }, weather: { snow: { cover: { amount: 1, ground: 'white!' } } } });
  check('wrong backdrop color / cover key / cover color are reported', has(bad47, 'sky.backdrop', 'leading #') &&
    has(bad47, 'weather.snow.cover.amount', 'unknown') && has(bad47, 'weather.snow.cover.ground', 'bad color'), JSON.stringify(bad47.map(x => x.path)));
  let r = find({ exposur: 1, sky: { sunSise: 5, clouds: { colour: 1 } }, ui: { custom: 1 } });
  check('two fields written on one d.ts line are both known (sky.clouds color + shade)', schema.interfaces.StyleSkyClouds.keys.has('color') &&
    schema.interfaces.StyleSkyClouds.keys.has('shade') && find({ name: 'x', sky: { clouds: { color: '#fff', shade: '#888' } } }).length === 0);
  check('unknown top-level field with did-you-mean', has(r, 'exposur', "Did you mean 'exposure'"));
  check('unknown nested fields (sky, sky.clouds) are found; open ui keys are not', has(r, 'sky.sunSise', "'sunSize'") &&
    has(r, 'sky.clouds.colour', "'color'") && !r.some(x => x.path === 'ui.custom'));
  r = find({ water: { level: 3, color: 1 }, terrain: { config: { shading: 'flat', seed: 4 } }, seed: 1 });
  check('world fields are errors with where they go', has(r, 'water.level', 'water({') && has(r, 'terrain.config.seed', 'terrain({') &&
    has(r, 'seed', 'world state'));
  check('a world field is reported once (not also as unknown)', r.filter(x => x.path === 'water.level').length === 1 &&
    r.filter(x => x.path === 'terrain.config.seed').length === 1);
  check('shading under terrain.config is fine', !r.some(x => x.path === 'terrain.config.shading'));
  const refs = paletteRefs("const c = pal(this);\nreturn [c.bark, c.leaf, pal(this).rock, this.palette.stem];\n// c.commented\nconst pal = ctx => ({ ...P });");
  check('palette references are found (alias, direct, this.palette), comments skipped', ['bark', 'leaf', 'rock', 'stem'].every(k => refs.has(k)) &&
    !refs.has('commented'));
  r = find({ palette: { bark: 1, lef: 2, rock: 3, stem: 4 } }, { paletteRefs: refs });
  check('a palette key used but not defined is an error with did-you-mean', has(r, 'palette.leaf', "Did you mean 'lef'") &&
    r.every(x => x.path !== 'palette.bark'));
  r = find({ palette: { a: 0xff8800, b: '#abc', c: 'ff8800', d: '#12345', e: 0x1ffffff, f: 1.5, g: '0xff0000', h: {} }, ui: { bg: 'rgba(0,0,0,.5)', fg: '#12' }, water: { color: 'rgba(1,2,3,.5)' } });
  check('color formats: bad ones are errors', ['palette.c', 'palette.d', 'palette.e', 'palette.f', 'palette.g', 'palette.h', 'ui.fg', 'water.color'].every(p => has(r, p, 'bad color')));
  check('color formats: good ones pass (number, #abc, css function in ui)', !['palette.a', 'palette.b', 'ui.bg'].some(p => r.some(x => x.path === p)));
  check('colorProblem names the fix for a missing #', colorProblem('ff8800').includes("'#ff8800'"));
  // water look hooks (recipes/44): the new keys are known, nested typos and bad colors are found
  const waterLook = { depthColor: { shallow: 0x55ddcc, deep: '#082040', by: 'wave', curve: 1.5 }, foam: { color: 0xffffff, start: 0.5, end: 0.8, opacity: 0.9 },
    glsl: { wave: 'float threedogWaterWave(vec3 p, float t) { return 0.0; }', surface: '', waveMax: 0.3 }, uniforms: { uBands: 4 } };
  check('style check knows the water look keys (depthColor, foam, glsl, uniforms)', find({ name: 'x', water: waterLook }).length === 0 && find({ name: 'x', water: { foam: true } }).length === 0);
  r = find({ water: { depthColor: { shalow: 1, deep: '#12' }, foam: { colour: 1 } } });
  check('water look typos and bad colors are found', has(r, 'water.depthColor.shalow', "'shallow'") && has(r, 'water.foam.colour', "'color'") && has(r, 'water.depthColor.deep', 'bad color'));
  const drops = { shape: 'soft', color: 0x99aacc, opacity: 0.5, size: 12, maxSize: 6, length: 1, speed: 18, slant: 2, sway: 1, count: 4000, density: a => a,
    glsl: { vertex: '', fragment: '' }, uniforms: { uTint: [1, 1, 1] } };
  check('style check knows the weather particle and lightning keys', find({ name: 'x', weather: { rain: drops, snow: { shape: 'square' }, lightning: f => f } }).length === 0);
  r = find({ weather: { rain: { shap: 'soft' }, snow: { colour: 1 } } });
  check('weather particle typos are found', has(r, 'weather.rain.shap', "'shape'") && has(r, 'weather.snow.colour', "'color'"));
  r = find({ sky: { keyframes: [[0, 1, 2, 3, 1, 1], [0.5, 1, 2]] } });
  check('a sky keyframe with the wrong length is an error', has(r, 'sky.keyframes[1]', '6 entries'));
  const fx = (n, o = {}) => ({ name: n, create: () => ({}), ...o });
  r = find({ post: [fx('bloom'), fx('bloom'), fx('p', { slot: 'weird' }), { name: 'empty' }, fx('s1', { slot: 'scene' }), fx('s2', { slot: 'scene' })] });
  check('post: duplicate name, unknown slot, no create, two scene effects', has(r, 'post[1]', 'two post effects') && has(r, 'post[2]', "unknown slot") &&
    has(r, 'post[3]', 'neither create') && has(r, 'post', "'scene'"));
  r = find({ post: [fx('grade', { slot: 'hdr', order: 1, fuse: { glsl: '' } }), fx('outline', { needsDepth: true, order: 5 }), fx('late', { needsDepth: true, slot: 'ldr' })] });
  check('post: a depth reader after a buffer-swapping (fuse) effect, and one after tone mapping, are errors', has(r, 'post[1]', 'reads scene depth') && has(r, 'post[2]', 'after tone mapping'));
  r = find({ post: [fx('outline', { needsDepth: true, enabled: true, order: 10 }), fx('dof', { needsDepth: true, enabled: true, order: 15 })] });
  check('post: outline sorted before dof (both on) is an error that says dof goes first', has(r, 'post[1]', "'dof' runs after 'outline'") && r[0].level === 'error');
  r = find({ post: [fx('outline', { needsDepth: true, enabled: true, order: 10 }), fx('dof', { needsDepth: true, enabled: true, order: 5 })] });
  check('post: dof before outline, both on, is fine (dof passes the depth on)', r.length === 0);
  r = find({ post: [fx('dof', { needsDepth: true, enabled: false }), fx('outline', { needsDepth: true, enabled: true })] });
  check('post: dof off with outline on is fine', r.length === 0);
  r = find({ post: [fx('a'), fx('b'), fx('c'), fx('d', { enabled: false })] });
  check('post: more than 2 effects on is a warning (not an error); disabled ones do not count', r.length === 1 && r[0].level === 'warn' &&
    has(r, 'post', 'only the necessary') && has(r, 'post', '3 post effects'));
  check('post: two effects on is fine', find({ post: [fx('a'), fx('b')] }).length === 0);
  r = find({ materials: { vegtation: { type: 'lambert' }, default: { type: 'toom' }, furniture: {} } }, {});
  check('materials: misspelled role warns, unknown type errors, own role names are fine', has(r, 'materials.vegtation', "'vegetation'") &&
    has(r, 'materials.default.type', "Did you mean 'toon'") && !r.some(x => x.path === 'materials.furniture'));
  r = find({ character: { model: 'wolfy' }, ui: { fonts: ['pixel', 'nope'], font: 'url(a.woff2)' }, terrain: { detail: { texture: '/textures/grain.png' } } },
    { assets: { models: new Set(['wolf']), fonts: new Set(['pixel']) } });
  check('asset names: a missing model / font is reported with did-you-mean; paths are not checked', has(r, 'character.model', "Did you mean 'wolf'") &&
    has(r, 'ui.fonts[1]', 'font asset') && !r.some(x => x.path === 'ui.fonts[0]' || x.path === 'terrain.detail.texture'));
  check('a font file in ui.font is an error', has(r, 'ui.font', 'font file'));
  r = find({ materials: { rock: { type: 'standard', map: 'rock', normalMap: 'rok_n', detail: { texture: 'grain', noise: 'paper' } }, wall: { map: '/img/wall.png' } },
    seasons: { mode: 'mix', strength: 0.4, autumn: { foliage: 0xd98a3a } }, lighting: { rim: { color: 0xffffff } } }, { assets: { textures: new Set(['rock', 'rock_n', 'grain']) } });
  check('material texture names are checked against the asset pack (map, normalMap, detail.texture); paths and known names pass; seasons.mode and lighting are known fields',
    has(r, 'materials.rock.normalMap', "Did you mean 'rock_n'") &&
    !r.some(x => ['materials.rock.map', 'materials.rock.detail.texture', 'materials.wall.map'].includes(x.path)) &&
    !r.some(x => /^(seasons|lighting)/.test(x.path)), JSON.stringify(r.map(x => x.path + ': ' + x.msg.slice(0, 60))));

  // ── a whole pack on disk: lowpoly passes, a wrong one fails ──
  const lp = await styleCheck('lowpoly');
  check('style check passes on lowpoly (its palette, post and materials)', lp.errors === 0);
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-style-'));
  try {
    const bad = join(tmp, 'bad.js');
    writeFileSync(bad, "export default [{ exposure: 1, water: { level: 2 }, palette: { a: 1 } }, { sky: { sunSise: 1 } }];\n");
    const b = await styleCheck(bad);
    check('a list of parts is merged before checking (errors from both parts)', has(b.findings, 'water.level', 'world state') &&
      has(b.findings, 'sky.sunSise', 'unknown'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // ── new-style ──
  const n = 'zz-test-style', dir = styleDir(n), link = join(ROOT, 'node_modules', '@threedog', `style-${n}`);
  try {
    createStyle(n, { lock: false });
    check('new-style writes package.json (MIT, @threedog/style-<name>), index.js, models.js, index.d.ts, README', ['package.json', 'index.js', 'models.js', 'index.d.ts', 'README.md', 'LICENSE'].every(f => existsSync(join(dir, f))));
    const pkg = JSON.parse((await import('node:fs')).readFileSync(join(dir, 'package.json'), 'utf8'));
    check('package name and license are filled in', pkg.name === `@threedog/style-${n}` && pkg.license === 'MIT' && !JSON.stringify(pkg).includes('__NAME__'));
    const g = await styleCheck(n);
    check('style check passes on the generated pack (model palette keys all defined)', g.errors === 0 && g.warnings === 0);
    check('a second new-style with the same name is refused', (() => { try { createStyle(n, { lock: false }); return false; } catch (e) { return /already exists/.test(e.message); } })());
    // R34 reads pack text: the water / weather look keys (one-line objects, sizes, glsl) are looks, never world state
    writeFileSync(join(dir, 'looks.js'), [
      "export const water = { depthColor: { shallow: 0x55ddcc, deep: 0x082040, by: 'wave' }, foam: { start: 0.5, end: 0.8 }, glsl: { waveMax: 0.3 }, uniforms: { uSize: 2 } };",
      "export const weather = { rain: { shape: 'soft', size: 9, count: 3000, density: a => a, glsl: { vertex: '', fragment: '' } }, snow: { sway: 2, size: 30 }, lightning: f => f };",
    ].join('\n'));
    const r34 = (await import('../rules/R34-style-looks-only.mjs')).default;
    check('R34 does not flag the water / weather look keys', !r34.run().some(x => x.file.endsWith(`${n}/looks.js`)), JSON.stringify(r34.run().filter(x => x.file.includes(n))));
    check('a bad name is refused', (() => { try { createStyle('Bad Name'); return false; } catch (e) { return /not allowed/.test(e.message); } })());
  } finally {
    // the link first: once the folder is gone a junction dangles and existsSync no longer sees it
    try { unlinkSync(link); } catch { try { rmdirSync(link); } catch { /* no link was made */ } }
    rmSync(dir, { recursive: true, force: true });
  }

  // ── palette: 60×40 picture, 70% sand, 20% dark blue, 10% bright red ──
  const tmp2 = mkdtempSync(join(tmpdir(), 'threedog-pal-'));
  try {
    const sand = [216, 192, 144], navy = [20, 30, 90], red = [230, 30, 30];
    writeFileSync(join(tmp2, 'ref.png'), png(60, 40, (x, y) => (y < 28 ? sand : y < 36 ? navy : red)));
    const p = await paletteOf(join(tmp2, 'ref.png'), 4);
    check('palette: the biggest color is the sand and is the base candidate', near(p.colors[0].hex, sand) && p.colors[0].roles.includes('base') &&
      near(p.roles.base.hex, sand));
    check('palette: the red is the most saturated (accent) and the navy the darkest', near(p.roles.accent.hex, red, 30) && near(p.roles.shadow.hex, navy, 30));
    check('palette: shares add up and the largest is about 70%', Math.abs(p.colors[0].share - 0.7) < 0.05);
    check('palette: summary says warm, mostly sand', p.stats.temperature === 'warm' && /warm colors, mostly (light )?sand/.test(p.summary));
    writeFileSync(join(tmp2, 'gray.png'), png(20, 20, () => [128, 128, 128]));
    const gray = await paletteOf(join(tmp2, 'gray.png'), 3);
    check('palette: a flat gray picture is neutral, low saturation, weak contrast', gray.stats.temperature === 'neutral' &&
      /low saturation/.test(gray.summary) && /weak light\/dark contrast/.test(gray.summary));
    check('palette: an unsupported file name gives a clear error', await paletteOf(join(tmp2, 'x.txt')).then(() => false, e => /use \.png/.test(e.message)));
  } finally { rmSync(tmp2, { recursive: true, force: true }); }
}
