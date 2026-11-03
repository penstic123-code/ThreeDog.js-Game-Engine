// style tools: `style check` on deliberately wrong styles, R34 on game style/ folders, `style palette` on a generated PNG.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import * as P from '../paths.mjs';
import { ENGINE } from '../paths.mjs';
import { loadSchema } from '../style/schema.mjs';
import { EXTRA } from '../threedog/dispatch.mjs';
import { checkStyle, paletteRefs, colorProblem } from '../style/check.mjs';
import { styleCheck } from '../style.mjs';
import { paletteOf } from '../style/palette.mjs';

export const name = 'style tools: check, R34, palette';

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
  check('CLI: style-palette help lists only options palette has (no --out)', !EXTRA['style-palette'].includes('--out'), EXTRA['style-palette']);
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
    uniforms: { uBands: 4 } };   // no glsl: water GLSL goes through engine.look.water.patch only
  check('style check knows the water look keys (depthColor, foam, uniforms)', find({ name: 'x', water: waterLook }).length === 0 && find({ name: 'x', water: { foam: true } }).length === 0);
  check('water.glsl is not a style key (the hook is look.water.patch)', find({ name: 'x', water: { glsl: { wave: '' } } }).some(x => x.path.startsWith('water.glsl')));
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
  // a style's post effects are its plugin files (look.post.add is the one way in): file i exports effect i, so findings name plugins/<i>-<name>
  const pl = (...effects) => ({ plugins: Object.fromEntries(effects.map((e, i) => [`./plugins/${i}-${e.name}.js`, { default: e }])) });
  r = find({ post: [fx('bloom')] });
  check('post: style.post is an error that points to style plugin files', has(r, 'post', 'style.post is gone') && has(r, 'post', 'export default bloom()'));
  r = find(pl(fx('bloom'), fx('bloom'), fx('p', { slot: 'weird' }), fx('s1', { slot: 'scene' }), fx('s2', { slot: 'scene' })));
  check('post: duplicate name, unknown slot, two scene effects', has(r, 'plugins/1-bloom', 'two post effects') && has(r, 'plugins/2-p', "unknown slot") && has(r, 'post', "'scene'"));
  // an added effect is on (r4 D1): the real factories, no enabled given, count as on
  { const P = await import('@threedog/post-effects');
    const on = find(pl(P.outline(), P.vignette(), P.grain())).filter(x => x.path === 'post' && x.msg.includes('post effect(s) on'));
    check('post: plugin effects without enabled count as on (3 files -> 3 on)', on.length === 1 && on[0].msg.startsWith('3 post effect(s) on'), JSON.stringify(on)); }
  r = find(pl(fx('grade', { slot: 'hdr', order: 1, fuse: { glsl: '' } }), fx('outline', { needsDepth: true, order: 5 }), fx('late', { needsDepth: true, slot: 'ldr' })));
  check('post: a depth reader after a buffer-swapping (fuse) effect, and one after tone mapping, are errors', has(r, 'plugins/1-outline', 'reads scene depth') && has(r, 'plugins/2-late', 'after tone mapping'));
  r = find(pl(fx('outline', { needsDepth: true, enabled: true, order: 10 }), fx('dof', { needsDepth: true, enabled: true, order: 15 })));
  check('post: outline sorted before dof (both on) is an error that says dof goes first', has(r, 'plugins/1-dof', "'dof' runs after 'outline'") && r[0].level === 'error');
  r = find(pl(fx('outline', { needsDepth: true, enabled: true, order: 10 }), fx('dof', { needsDepth: true, enabled: true, order: 5 })));
  check('post: dof before outline, both on, is fine (dof passes the depth on)', r.filter(x => x.level !== 'note').length === 0);
  r = find(pl(fx('dof', { needsDepth: true, enabled: false }), fx('outline', { needsDepth: true, enabled: true })));
  check('post: dof off with outline on is fine', r.filter(x => x.level !== 'note').length === 0);
  r = find(pl(fx('a'), fx('b'), fx('c'), fx('d', { enabled: false })));
  // how many effects is right is the game's call: the check reports which are on and how to see their cost, never a cap or "too many"
  check('post: effects on are one note (no warning, no cap); disabled ones do not count', r.length === 1 && r[0].level === 'note' &&
    has(r, 'post', "'a', 'b', 'c'") && !has(r, 'post', "'d'") && has(r, 'post', 'tier low') && !/more than|worse|necessary/.test(r[0].msg + r[0].fix));
  check('post: a costly effect is named as such', has(find(pl(fx('a', { costly: true }))), 'post', "'a' costly"));
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

  // ── a whole style folder on disk: the world example's passes, a wrong one fails ──
  const lp = await styleCheck(join(ENGINE, 'examples/world/style'));
  check('style check passes on the world example style (its post, materials and terrain colors)', lp.errors === 0);
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-style-'));
  try {
    const bad = join(tmp, 'bad.js');
    writeFileSync(bad, "export default [{ exposure: 1, water: { level: 2 }, palette: { a: 1 } }, { sky: { sunSise: 1 } }];\n");
    const b = await styleCheck(bad);
    check('a list of parts is merged before checking (errors from both parts)', has(b.findings, 'water.level', 'world state') &&
      has(b.findings, 'sky.sunSise', 'unknown'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // ── R34 on a game's own style/ folder ──
  // Looks are not packages: R34 must read every game's style/ folder (and nothing named like a style package). A throwaway game under games/
  // (the folder R34 walks in the monorepo), removed afterwards together with games/ when the test created it.
  const hadGames = existsSync(P.GAMES), game = join(P.GAMES, 'zz-test-style'), dir = join(game, P.GAME_STYLE_DIR);
  try {
    mkdirSync(dir, { recursive: true });
    // the water / weather look keys (one-line objects, sizes, glsl) are looks, never world state
    writeFileSync(join(dir, 'looks.js'), [
      "export const water = { depthColor: { shallow: 0x55ddcc, deep: 0x082040, by: 'wave' }, foam: { start: 0.5, end: 0.8 }, glsl: { waveMax: 0.3 }, uniforms: { uSize: 2 } };",
      "export const weather = { rain: { shape: 'soft', size: 9, count: 3000, density: a => a, glsl: { vertex: '', fragment: '' } }, snow: { sway: 2, size: 30 }, lightning: f => f };",
    ].join('\n'));
    // world shape in the same folder is caught: proves the rule really scans games/*/style, so a look cannot slip past it by living there
    writeFileSync(join(dir, 'index.js'), "export function height(x, z) { return 0; }\nexport default { water: { level: 2 } };\n");
    const { default: r34, styleFiles } = await import('../rules/R34-style-looks-only.mjs');
    const mine = r34.run().filter(x => x.file.includes('zz-test-style'));
    check('R34 does not flag the water / weather look keys', !mine.some(x => x.file.endsWith('looks.js')), JSON.stringify(mine));
    check("R34 scans a game's style/ folder: world shape and world state there are errors",
      mine.some(x => x.file.endsWith('index.js') && /world-shape/.test(x.msg)) && mine.some(x => /world state/.test(x.msg)), JSON.stringify(mine));
    check('R34 reads the examples\' style folders too', styleFiles().some(f => f.startsWith(`${P.EXAMPLES_REL}/world/${P.GAME_STYLE_DIR}/`)));
    // `style check` finds a game's look from the game (folder or workspace-like name), never from a style package name
    check('style check on a game folder checks its style/ (and its R34 findings)', (await styleCheck(game)).findings.some(x => /^\[R34\] a style carries world-shape/.test(x.msg)));
    // bake: a game's list is its bake.js files only (a style's `assets` export is not scanned), and hashing searches the game folder alone
    writeFileSync(join(game, 'bake.js'), 'export const bake = { box: () => null };\n');
    const { keyMaker } = await import('../vite/vite-threedog-cache.js');
    const kb = keyMaker(game);
    check("bake lists of a game are its bake.js files only, and a game's key search needs no styles folder",
      JSON.stringify(kb.bakeLists()) === JSON.stringify([P.rel(join(game, 'bake.js'))]) && kb({ name: 'box', src: '() => null' }).files.length > 0, JSON.stringify(kb.bakeLists()));
  } finally { rmSync(hadGames ? game : P.GAMES, { recursive: true, force: true }); }
  check('style check by a style package name is gone: a bare name that is no folder or game fails with the way out',
    await styleCheck('somepack').then(() => false, e => /no style found for "somepack".*style folder/.test(e.message)));
  check('paths.mjs has no style-package lookups left (STYLE_PKG_PREFIX / STYLES_REL / styleName / styleDir)',
    !['STYLE_PKG_PREFIX', 'STYLES_REL', 'styleName', 'styleDir'].some(k => k in P));

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
