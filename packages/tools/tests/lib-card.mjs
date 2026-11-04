// The entry card: measured at lib add from real files (a glb built here byte by byte, a png header), and derived for entries stored before cards.
// Why: pieces from different places only fit if size, up axis, color space and who-writes-what are known; a card that repeats what a form said would
// be empty the first time an AI skips the form, so every value below comes from the files.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { addEntry, entries } from '../lib.mjs';
import { measureModel, measureTexture, sizeNotes } from '../lib/lib-card.mjs';

export const name = 'lib card: every entry has needs, provides, writes, size, style and a usage of at most 10 lines; box, up axis, origin and color space are measured; an older entry gets its card from its files';

/** A minimal .glb: one mesh whose POSITION accessor spans min..max, under one node */
export function glb(min, max, node = {}, material = null) {
  const j = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...node }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ componentType: 5126, type: 'VEC3', count: 0, min, max }], ...(material ? { materials: [material] } : {}) };
  let t = Buffer.from(JSON.stringify(j));
  t = Buffer.concat([t, Buffer.alloc((4 - t.length % 4) % 4, 0x20)]);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + t.length, 8); head.writeUInt32LE(t.length, 12); head.writeUInt32LE(0x4E4F534A, 16);
  return Buffer.concat([head, t]);
}
/** The first bytes of a png: signature, IHDR with the size, an sRGB chunk when asked, then IDAT */
export function png(w, h, srgb = false) {
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); return Buffer.concat([l, Buffer.from(t, 'latin1'), d, Buffer.alloc(4)]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), ...(srgb ? [chunk('sRGB', Buffer.from([0]))] : []), chunk('IDAT', Buffer.alloc(1))]);
}

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-lib-card-'));
  const put = (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); };
  try {
    const a = join(tmp, 'game'), lib = join(tmp, 'library');
    put(join(a, 'package.json'), '{"name":"game"}');

    // models: box through a node transform, origin, up axis
    const f = n => join(tmp, n);
    put(f('hut.glb'), glb([-2, 0, -2], [2, 3, 2], {}, { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }));
    put(f('scaled.glb'), glb([-1, 0, -1], [1, 2, 1], { scale: [0.5, 0.5, 0.5], translation: [0, 1, 0] }));
    put(f('laid.glb'), glb([-0.25, 0, -0.9], [0.25, 0.3, 0.9]));
    put(f('huge.glb'), glb([-30, 0, -30], [30, 180, 30], { scale: [10, 10, 10] }));
    const hut = measureModel(f('hut.glb'));
    check('model: box in meters, origin at the feet, Y up, base color measured', hut.size.box.join() === '4,3,4' && hut.size.origin === 'feet' && hut.size.up === 'y' && hut.colors.join() === '#ff0000', JSON.stringify(hut));
    const sc = measureModel(f('scaled.glb'));
    check('model: node scale and translation count', sc.size.box.join() === '1,1,1' && sc.size.origin === 'other', JSON.stringify(sc));
    const laid = measureModel(f('laid.glb')), huge = measureModel(f('huge.glb'));
    check('model: long and low is told as laid on its side, with the fix', laid.size.up === 'z' && sizeNotes('hero', laid.size).some(n => /export it with Y up/.test(n)), JSON.stringify(laid));
    check('model: a 1800 m thing is told as the wrong unit, with the fix', sizeNotes('hero', huge.size).some(n => /exported in centimeters/.test(n)), JSON.stringify(huge));

    // textures: pixels, and color against data maps
    put(f('wall.png'), png(512, 256));
    put(f('wall_normal.png'), png(64, 64, true));
    const wall = measureTexture(f('wall.png')), nrm = measureTexture(f('wall_normal.png'));
    check('texture: pixels from the file, a color map is sRGB', wall.pixels.join() === '512,256' && wall.map === 'color' && wall.colorSpace === 'srgb', JSON.stringify(wall));
    check('texture: a normal map is linear, and an sRGB tag on it is reported with the fix', nrm.map === 'data' && nrm.colorSpace === 'linear' && sizeNotes('wall', nrm).some(n => /NoColorSpace/.test(n)), JSON.stringify(nrm));

    // code: who needs, gives and writes what, comments not counted
    put(join(a, 'picture', 'dusk.js'), [
      '// Dusk sky: a gradient dome and thin fog.',
      '// Params: top, horizon colors. Returns { mesh, update(signals) }.',
      "import { thing } from 'some-package';",
      'export function duskSky(THREE, scene, { top = 0x1b2350, horizon = 0x9a4f62 } = {}) {',
      '  // scene.background = null is what this does NOT do',
      '  scene.fog = new THREE.FogExp2(horizon, 0.01);',
      '  const sun = new THREE.DirectionalLight(top);',
      '  const mine = { uWind: { value: 0 } };',
      '  return { sun, update(signals) { sun.intensity = signals.uDaylight.value; signals.uSkyTop.value.set(top); if (signals.uWind) mine.uWind.value = signals.uWind.value; }, thing };',
      '}',
    ].join('\n'));
    put(join(a, 'systems', 'heat.js'), "/** Heat meter */\nexport function heat() { return { name: 'heat', type: 'rules', requires: ['characters'], provides: ['warmth'], install() { return {}; } }; }\n");
    const dusk = (await addEntry('picture/dusk.js', { game: a, cwd: tmp, lib, kind: 'picture', noPreview: true, style: ['painted', 'warm'] })).entry;
    check('card: signals read and written are told apart, packages are listed, three is not a need',
      dusk.needs.signals.join() === 'uDaylight,uWind' && dusk.provides.signals.join() === 'uSkyTop' && dusk.needs.packages.join() === 'some-package' && dusk.provides.exports.join() === 'duskSky', JSON.stringify(dusk));
    check('card: writes lists the shared values, a line in a comment does not count', dusk.writes.join() === 'light.sun,scene.fog', dusk.writes.join());
    check('card: style keeps the given tags and measures the colors', dusk.style.tags.join() === 'painted,warm' && dusk.style.colors.includes('#1b2350'), JSON.stringify(dusk.style));
    check('card: usage is the file\'s own header plus the use line', dusk.usage.startsWith('Dusk sky: a gradient') && /import \{/.test(dusk.usage) && dusk.usage.split('\n').length <= 10, dusk.usage);
    const heat = (await addEntry('systems/heat.js', { game: a, cwd: tmp, lib, name: 'heat', kind: 'module', noPreview: true })).entry;
    check('card: a module\'s requires, name and provides are the engine\'s own words', heat.needs.modules.join() === 'characters' && heat.provides.modules.join() === 'heat,warmth', JSON.stringify(heat));

    put(join(a, 'art', 'hut.glb'), glb([-2, 0, -2], [2, 3, 2]));
    const m = await addEntry('art/hut.glb', { game: a, cwd: tmp, lib, noPreview: true });
    check('add: a model entry stores its measured size', m.entry.kind === 'model' && m.entry.size.box.join() === '4,3,4' && !m.notes.length, JSON.stringify(m.entry));

    // [guard] every entry that can be read has the whole card, also one stored before cards existed
    const old = JSON.parse(readFileSync(join(lib, 'dusk', 'entry.json'), 'utf8'));
    for (const k of ['needs', 'provides', 'writes', 'size', 'style', 'usage']) delete old[k];
    writeFileSync(join(lib, 'dusk', 'entry.json'), JSON.stringify(old));
    const all = entries(lib), noCard = all.filter(e => ['needs', 'provides', 'writes', 'style', 'usage'].some(k => e[k] === undefined) || e.size === undefined);
    check('[guard] every entry read from the library has the whole card', all.length === 3 && !noCard.length, noCard.map(e => e.name).join());
    check('an older entry gets its card from its files, and its entry.json is left alone', all.find(e => e.name === 'dusk').writes.join() === 'light.sun,scene.fog' && !JSON.parse(readFileSync(join(lib, 'dusk', 'entry.json'), 'utf8')).writes);

    const ls = spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', 'list', 'heat', '--card'], { cwd: a, encoding: 'utf8', env: { ...process.env, THREEDOG_LIBRARY: lib } });
    check('cli list --card prints the card under the line', /^heat /m.test(ls.stdout) && /needs: modules characters/.test(ls.stdout) && /writes: nothing/.test(ls.stdout), ls.stdout + ls.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
