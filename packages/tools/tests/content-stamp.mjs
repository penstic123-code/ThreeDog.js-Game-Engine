// `threedog content stamp` and `set --source` (content-stamp.mjs), no browser.
// Why these checks: the promises flat content rests on. A stamp is plain entries and a place, or nothing at all (a half-written stamp would leave
// a place without its parts); a batch edit touches exactly the named part of every copy and says how many; a dry run writes nothing.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { stamp, setBySource } from '../content-stamp.mjs';
import { scanGame } from '../rules/R52-captured-twice.mjs';

export const name = 'content stamp: an arrangement becomes a place and plain entries or nothing; id clash; set --source edits every copy, --dry first';

const STALL = `export default [
  { part: 'chest', template: 'chest', x: 1 },
  { part: 'post', model: 'post', x: -1, z: 2, rot: 0.5 },
];
`;
const importNow = async (path, n) => (await import(pathToFileURL(path).href + `?n=${n}`)).default;

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-stamp-'));
  try {
    mkdirSync(join(dir, 'content/arrangements'), { recursive: true });
    writeFileSync(join(dir, 'main.js'), '\n');
    writeFileSync(join(dir, 'content/templates.js'), "export default { chest: { model: 'chest' } };\n");
    writeFileSync(join(dir, 'content/arrangements/stall.js'), STALL);
    writeFileSync(join(dir, 'content/arrangements/ghost.js'), "export default [\n  { part: 'a', model: 'post' },\n  { part: 'b', template: 'nope' },\n];\n");
    const props = join(dir, 'content/props.js'), places = join(dir, 'content/places.js');
    const text = p => readFileSync(p, 'utf8');

    // [guard] a write that throws (a locked file) mid-batch left the place written and its entries not: here the temp path of props.js is a folder, so its write fails on any system
    writeFileSync(props, 'export default [\n];\n');
    writeFileSync(places, 'export default {\n};\n');
    mkdirSync(props + '.threedog-tmp');
    const thrown = await stamp(dir, { arrangement: 'stall', id: 'stall-0', x: 1, z: 1 });
    check('[guard] stamp: a thrown write undoes the batch and says so', !thrown.ok && text(places) === 'export default {\n};\n', JSON.stringify(thrown) + text(places));
    rmSync(props + '.threedog-tmp', { recursive: true });
    rmSync(props); rmSync(places);

    // a game with no places.js and no props.js yet: stamp makes them
    const dry = await stamp(dir, { arrangement: 'stall', id: 'stall-1', x: 20, z: 5, rot: 1.6 }, { dry: true });
    check('stamp --dry: shows the entries and writes nothing', dry.ok && dry.entries.length === 2 && !existsSync(props) && !existsSync(places), JSON.stringify(dry));
    const a = await stamp(dir, { arrangement: 'stall', id: 'stall-1', x: 20, z: 5, rot: 1.6 });
    check('stamp: ok', a.ok, a.error);
    const p1 = await importNow(places, 1), e1 = await importNow(props, 1);
    check('stamp: one place with its turn', JSON.stringify(p1) === '{"stall-1":{"x":20,"z":5,"rot":1.6}}', text(places));
    check('stamp: plain entries in the agreed form, ids <place>-<part>, source named, no part left',
      JSON.stringify(e1[0]) === JSON.stringify({ id: 'stall-1-chest', template: 'chest', place: 'stall-1', x: 1, source: 'stall' })
      && JSON.stringify(e1[1]) === JSON.stringify({ id: 'stall-1-post', model: 'post', place: 'stall-1', x: -1, z: 2, rot: 0.5, source: 'stall' }), text(props));
    await stamp(dir, { arrangement: 'stall', id: 'stall-2', x: -4, z: 0 });
    const p2 = await importNow(places, 2);
    check('stamp without rot: the place has none', JSON.stringify(p2['stall-2']) === '{"x":-4,"z":0}', text(places));

    // clash: every file stays byte for byte
    const before = [text(props), text(places)];
    const same = await stamp(dir, { arrangement: 'stall', id: 'stall-1', x: 0, z: 0 });
    check('clash on the place id: refused, names the file, nothing written', !same.ok && /clash/.test(same.error) && /content\/places\.js/.test(same.error)
      && before[0] === text(props) && before[1] === text(places), same.error);
    writeFileSync(props, text(props).replace('];', "  { id: 'x-post', model: 'post', x: 9, z: 9 },\n];"));
    const partClash = [text(props), text(places)];
    const part = await stamp(dir, { arrangement: 'stall', id: 'x', x: 0, z: 0 });
    check('clash on one part id only: refused before the place is written', !part.ok && part.clash?.length === 1 && /x-post/.test(part.error)
      && partClash[0] === text(props) && partClash[1] === text(places), part.error);
    // a failure half way through the writes (the template does not exist): what was already written comes back out
    const ghost = await stamp(dir, { arrangement: 'ghost', id: 'g', x: 0, z: 0 });
    check('a failure after the first writes: everything is undone', !ghost.ok && /nope/.test(ghost.error) && partClash[0] === text(props) && partClash[1] === text(places), ghost.error);
    const missing = await stamp(dir, { arrangement: 'nothing', id: 'n', x: 0, z: 0 });
    check('no such arrangement: says how to make one', !missing.ok && /content capture/.test(missing.error), missing.error);

    // --source
    const unchanged = text(props);
    const look = await setBySource(dir, { source: 'stall', part: 'post', fields: { y: 2.5 } }, { dry: true });
    check('set --source --dry: lists both copies, writes nothing', look.ok && look.dry && look.changed.length === 2 && unchanged === text(props), JSON.stringify(look));
    const set = await setBySource(dir, { source: 'stall', part: 'post', fields: { y: 2.5 } });
    const e3 = await importNow(props, 3), by = id => e3.find(p => p.id === id);
    check('set --source: every copy of that part changed, count reported', set.ok && set.changed.length === 2 && by('stall-1-post').y === 2.5 && by('stall-2-post').y === 2.5, JSON.stringify(set));
    check('set --source: other parts and entries without the source untouched', by('stall-1-chest').y === undefined && by('x-post').y === undefined, text(props));
    const again = await setBySource(dir, { source: 'stall', part: 'post', fields: { y: 2.5 } });
    check('set --source again: nothing changed, and it says so', again.ok && !again.changed.length && again.same.length === 2, JSON.stringify(again));
    const wrong = await setBySource(dir, { source: 'stall', part: 'roof', fields: { y: 1 } });
    check('set --source, unknown part: lists the parts', !wrong.ok && /chest/.test(wrong.error) && /post/.test(wrong.error), wrong.error);
    const moved = await setBySource(dir, { source: 'stall', part: 'post', fields: { place: 'other' } });
    check('set --source cannot change place (the part is read from it)', !moved.ok && /place/.test(moved.error), moved.error);

    // one copy cannot be edited: the batch refuses before writing any
    writeFileSync(props, text(props).replace('];', "  { id: 'stall-3-post', model: 'post', place: 'stall-2', source: 'stall' },\n  { id: 'stall-4-post', model: 'post', place: 'stall-4', source: 'stall', x: 1 + 1 },\n];"));
    const coded = text(props);
    const code = await setBySource(dir, { source: 'stall', part: 'post', fields: { x: 3 } });
    check('set --source with a computed value in one copy: refused, nothing written', !code.ok && /stall-4-post/.test(code.error) && coded === text(props), code.error);
    const odd = await setBySource(dir, { source: 'stall', part: 'chest', fields: { y: 1 } });
    check('an entry whose id is not <place>-<part> is named, not skipped in silence', odd.ok && odd.odd.includes('stall-3-post'), JSON.stringify(odd));

    // R52: a captured group still named in code, once content holds a copy
    const game = {
      'g/content/arrangements/stall.js': "// Arrangement 'stall', captured from group 'stall-group' (threedog content capture).\nexport default [];\n",
      'g/content/props.js': "export default [{ id: 'a', source: 'stall' }];\n",
      'g/main.js': "const g = new Group();\ng.name = 'stall-group';\n",
    };
    const scan = over => { const f = { ...game, ...over }; return scanGame(Object.keys(f), p => f[p]); };
    const hit = scan();
    check('R52: stamped and still named in code: warned at that line', hit.length === 1 && hit[0].level === 'warn' && hit[0].file === 'g/main.js' && hit[0].line === 2, JSON.stringify(hit));
    check('R52: not stamped yet, or the code is gone: quiet', !scan({ 'g/content/props.js': 'export default [];\n' }).length && !scan({ 'g/main.js': '\n' }).length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
