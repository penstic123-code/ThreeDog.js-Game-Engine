// Content write-back (content-write.mjs) and folder kinds + the id index (content-check/load.mjs, index-ids.mjs), no browser.
// Why these checks and not others: they are the promises the editor and the AI rely on and that a "simpler" rewrite would quietly break:
// one value changes and nothing else (comments, alignment), a stale caller is refused instead of overwriting, a failed check leaves the old
// file, code-generated entries are refused with their line, and a write opens only its one file however big the game is.
import * as fs from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';
import { contentWrite, lit, stats } from '../content-write.mjs';
import { writeChecked } from '../lib/atomic.mjs';
import { checkGame } from '../content-check.mjs';
import { loadGame, partOf } from '../content-check/load.mjs';

export const name = 'content write: set / add / remove in place (comments kept), expect conflict, restore on failed check, one file read; folder kinds + id index';

const PROPS = `const gen = [{ id: 'g1', template: 'crate', x: 9, z: 9 }];
export default [
  { id: 'a',    template: 'crate', x: 0,  z: 0 },   // keep me
  { id: 'b',    template: 'fence', x: 1,  z: 1, scale: gen.length },
  { id: 'c',    template: 'crate', x: 2,  z: 2 },
  ...gen,
];
`;

/** fs with a count of every content file read (the index file is not content) */
function countingIo(dir) {
  const reads = [];
  return { reads, io: { ...fs, readFileSync: (p, ...a) => { if (String(p).includes(join(dir, 'content'))) reads.push(String(p)); return fs.readFileSync(p, ...a); } } };
}

export async function run({ check }) {
  const root = mkdtempSync(join(tmpdir(), 'td-write-'));
  try {
    // ── a small game ──
    const dir = join(root, 'small');
    mkdirSync(join(dir, 'content'), { recursive: true });
    writeFileSync(join(dir, 'main.js'), '\n');
    writeFileSync(join(dir, 'content/templates.js'), "export default { crate: { model: 'crate' }, fence: { model: 'fence' } };\n");
    writeFileSync(join(dir, 'content/items.js'), "export default { apple: { name: 'Apple' } };\n");
    writeFileSync(join(dir, 'content/pickups.js'), "export default [\n  { item: 'apple', x: 1, z: 1 },\n  { item: 'apple', x: 2, z: 2 },\n];\n");
    writeFileSync(join(dir, 'content/props.js'), PROPS);
    await checkGame(dir);   // writes .threedog/content-index.json
    const props = () => readFileSync(join(dir, 'content/props.js'), 'utf8');
    const w = (req, opt) => contentWrite(dir, req, opt);

    const { reads, io } = countingIo(dir);
    const s = await w({ op: 'set', id: 'b', fields: { x: 12.5 } }, { io });
    check('set replaces only the value: comments and column alignment unchanged', s.ok && props() === PROPS.replace("x: 1,  z: 1, scale", "x: 12.5,  z: 1, scale"), s.error ?? props());
    check('set read one content file and no other (the index named it)', reads.length === 1 && reads[0].endsWith('props.js'), reads.join(', '));
    const m = await w({ op: 'set', id: 'c', fields: { x: 3, place: 'home' }, expect: { x: 2 } });
    check('several fields in one write, a missing one added after the last property', m.ok && props().includes("x: 3,  z: 2, place: 'home' }"), m.error ?? props());

    const before = props();
    const c = await w({ op: 'set', id: 'c', fields: { x: 7 }, expect: { x: 2 } });
    check('expect (the old value the caller saw) differs from the file: refused as a conflict, nothing written', !c.ok && c.conflict && /is 3 in the file now/.test(c.error) && props() === before, c.error);
    const f = await w({ op: 'set', id: 'c', fields: { template: 'nope' } });
    check('a write that fails the check is restored: the file is byte-for-byte what it was', !f.ok && /restored/.test(f.error) && /template 'nope'/.test(f.error) && props() === before, f.error);
    check('a value computed by code is refused with its line', /computed by code.*line 4/.test((await w({ op: 'set', id: 'b', fields: { scale: 2 } })).error ?? ''));
    const g = await w({ op: 'set', id: 'g1', fields: { x: 1 } });
    check('an entry built by code (after a spread) is refused with the line of the code', !g.ok && g.generated && /props\.js:\d+.*built by code/.test(g.error), g.error);
    // the editor's expect: JSON has no undefined, so null means "not set"; and a field an undo put back sits at the end of the entry
    const held = props();
    const nulled = await w({ op: 'set', id: 'c', fields: { scale: null } }), edited = await w({ op: 'set', id: 'c', fields: { scale: 2 }, expect: { scale: undefined } });
    check('a field written as null can be edited: null from the page means not set', nulled.ok && edited.ok, JSON.stringify([nulled, edited]));
    await w({ op: 'set', id: 'c', fields: { size: { w: 1, h: 2 } }, unset: ['scale'] });
    check('key order is not a value: an expect with equal fields in another order goes through', (await w({ op: 'set', id: 'c', fields: {}, unset: ['size'], expect: { size: { h: 2, w: 1 } } })).ok && props() === held, props());
    const hand = join(root, 'hand.txt');
    writeFileSync(hand, 'old');
    await writeChecked(hand, 'old', 'new', () => { writeFileSync(hand, 'saved by hand'); return ['bad']; });
    check('a failed check does not overwrite a hand save made during it', readFileSync(hand, 'utf8') === 'saved by hand');
    check('an unknown id is explained', /no content entry with id 'zzz'/.test((await w({ op: 'set', id: 'zzz', fields: { x: 1 } })).error ?? ''));
    const t = await w({ op: 'set', id: 'crate', fields: { model: 'box' } });
    check('a named entry (template key) is edited when no placed entry has that id', t.ok && readFileSync(join(dir, 'content/templates.js'), 'utf8').includes("crate: { model: 'box' }"), t.error);

    const a = await w({ op: 'add', kind: 'props', entry: { id: 'd', template: 'crate', x: 5, z: 5 } });
    check('add appends after the last literal on its own line, trailing comma kept', a.ok && props().includes("  ...gen,\n  { id: 'd', template: 'crate', x: 5, z: 5 },\n];"), a.error ?? props());
    check('add without an id is refused (a position id shifts)', /needs an id/.test((await w({ op: 'add', kind: 'props', entry: { template: 'crate', x: 1, z: 1 } })).error ?? ''));
    check('add with an id that exists is refused', /already used/.test((await w({ op: 'add', kind: 'props', entry: { id: 'a', template: 'crate', x: 1, z: 1 } })).error ?? ''));
    const whole = props();
    await w({ op: 'set', id: 'a', fields: { note: 1 } });
    check('[guard] unset refused by a stale expect', (await w({ op: 'set', id: 'a', unset: ['note'], expect: { note: 2 } })).conflict === true && props() !== whole);
    check('[guard] a field added at the end comes off byte for byte', (await w({ op: 'set', id: 'a', unset: ['note'], expect: { note: 1 } })).ok && props() === whole, props());
    // a field cut from the middle goes back in front of the one that followed it (spot), and a field with no such neighbour still goes to the end
    const mid = props();
    const took = await w({ op: 'set', id: 'c', unset: ['x'], expect: { x: 3 } }), midGone = props();
    const put = await w({ op: 'set', id: 'c', fields: { x: 3 }, spot: { x: 'z' }, expect: { x: undefined } });
    check('[guard] set with spot puts a cut field back in its place, before the field that followed it', took.ok && midGone !== mid && put.ok && /id: 'c',\s+template: 'crate', x: 3, z: 2/.test(props()), props());
    check('set with a spot that is not there falls back to the end', (await w({ op: 'set', id: 'c', fields: { rot: 1 }, spot: { rot: 'nope' } })).ok && /rot: 1 \}/.test(props()));
    await w({ op: 'set', id: 'c', unset: ['rot'] });
    writeFileSync(join(dir, 'content/props.js'), mid);   // the c line lost its double space to the separator: the later byte checks start from the file as it was
    // an entry with a value computed by code can be cut: the comparison is on what is written out, and restore puts all of it back
    const lineB = props().split('\n').find(l => l.includes("id: 'b'")), nowB = props();
    const cutB = await w({ op: 'remove', id: 'b', expect: { id: 'b', template: 'fence', x: 12.5, z: 1 } });
    check('remove of an entry with a computed value: compared on its written values, cut whole', cutB.ok && !props().includes("id: 'b'") && nowB.includes(lineB), cutB.error ?? props());
    check('restore brings the computed entry back byte for byte', (await w({ op: 'restore', id: 'b', ...cutB.restore })).ok && props() === nowB, props());
    const cut = await w({ op: 'remove', id: 'a' }), gone = props();
    check('[guard] restore puts the cut bytes back in the same spot', (await w({ op: 'restore', id: 'a', ...cut.restore })).ok && props() === whole, props());
    check('[guard] restore refuses an entry that is there again', (await w({ op: 'restore', id: 'a', ...cut.restore })).conflict === true && props() === whole);
    check('[guard] restore stays inside content/', /only edits/.test((await w({ op: 'restore', id: 'a', ...cut.restore, file: 'main.js' })).error ?? ''));
    const r = await w({ op: 'remove', id: 'a' });
    writeFileSync(join(dir, 'content/props.js'), gone.replace(r.restore.after.slice(0, 12), r.restore.after.slice(0, 12) + ' '));
    check('[guard] restore refuses when the text around the cut changed: no guessing a spot', (await w({ op: 'restore', id: 'a', ...r.restore })).conflict === true);
    writeFileSync(join(dir, 'content/props.js'), gone);
    check('remove cuts the entry, its comma and its line (comment of that line too), nothing else', r.ok && !props().includes("id: 'a'") && props().startsWith("const gen = [{ id: 'g1', template: 'crate', x: 9, z: 9 }];\nexport default [\n  { id: 'b',"), r.error ?? props());
    const pr = await w({ op: 'remove', id: 'pickup:apple:0' });
    check('remove refuses when later entries take their id from their position', !pr.ok && /shift the ids/.test(pr.error), pr.error);
    check('lit() writes content-style literals', lit({ a: [1, 'x'], 'b-c': true }) === "{ a: [1, 'x'], 'b-c': true }");
    check('a file outside content/ is refused', /only edits .js files inside/.test((await w({ op: 'set', id: 'x', file: 'main.js', fields: { x: 1 } })).error ?? ''));

    // ── a big game: 5000 placements in 20 files of content/props/ ──
    const big = join(root, 'big');
    mkdirSync(join(big, 'content/props'), { recursive: true });
    writeFileSync(join(big, 'main.js'), '\n');
    writeFileSync(join(big, 'content/templates.js'), "export default { crate: { model: 'crate' } };\n");
    // content 点名了模型 crate：资源名只认 assets.js 导出的资源包（content-assets.mjs 守着这条），所以这个游戏要有一份登记 crate 的
    writeFileSync(join(big, 'assets.js'), "export default [{ name: 'big', models: { crate: () => null } }];\n");
    for (let f = 0; f < 20; f++) {
      const rows = Array.from({ length: 250 }, (_, i) => `  { id: 'p${f}-${i}', template: 'crate', x: ${i}, z: ${f} },   // row ${i}`);
      writeFileSync(join(big, `content/props/part${String(f).padStart(2, '0')}.js`), `// area ${f}\nexport default [\n${rows.join('\n')}\n];\n`);
    }
    const loaded = await loadGame(big);
    check('a folder kind loads as one joined array, in file-name order', loaded.data.props.length === 5000 && loaded.data.props[250].id === 'p1-0' && !loaded.errors.length, loaded.errors.join('; '));
    const at = partOf(loaded.parts, 'props', 3131);
    check('partOf maps a joined index to its file and index there', at?.path.endsWith('part12.js') && at.index === 131, JSON.stringify(at));
    const bigCheck = await checkGame(big);
    check('content check passes on the folder kind and writes the index', !bigCheck.errors.length && fs.existsSync(join(big, '.threedog/content-index.json')), bigCheck.errors.slice(0, 3).join('; '));
    const big1 = countingIo(big);
    stats.parsed = 0;
    const t0 = performance.now();
    const bw = await contentWrite(big, { op: 'set', id: 'p13-100', fields: { x: 42 } }, { io: big1.io });
    const ms = performance.now() - t0;
    check('one write in a 5000-entry game reads and parses only its own file', bw.ok && big1.reads.length === 1 && big1.reads[0].endsWith('part13.js') && stats.parsed <= 3, `${bw.error ?? ''} reads=${big1.reads.length} parsed=${stats.parsed}`);
    check('…and is fast (under 1 s; it does not load the other 19 files)', ms < 1000, `${ms.toFixed(0)} ms`);
    check('the edit landed on the right line of that file', readFileSync(join(big, 'content/props/part13.js'), 'utf8').includes("{ id: 'p13-100', template: 'crate', x: 42, z: 13 },   // row 100"));

    // ── duplicates across the files of a kind ──
    const dup = join(root, 'dup');
    mkdirSync(join(dup, 'content/props'), { recursive: true });
    mkdirSync(join(dup, 'content/templates'), { recursive: true });
    writeFileSync(join(dup, 'main.js'), '\n');
    writeFileSync(join(dup, 'content/templates/a.js'), "export default { crate: { model: 'crate' } };\n");
    writeFileSync(join(dup, 'content/templates/b.js'), "export default { crate: { model: 'box' } };\n");
    writeFileSync(join(dup, 'content/props/a.js'), "export default [{ id: 'x', template: 'crate', x: 0, z: 0 }];\n");
    writeFileSync(join(dup, 'content/props/b.js'), "export default [{ id: 'x', template: 'crate', x: 1, z: 1 }];\n");
    const de = (await checkGame(dup)).errors;
    check('the same placed id in two files of a kind is an error naming both', de.some(e => /props\/b\.js:1: id "x" is also used by content\/props\/a\.js:1/.test(e)), de.join('\n'));
    check('the same key in two files of an object kind is an error naming both', de.some(e => /templates[\\/]b\.js: "crate" is also defined in .*templates[\\/]a\.js/.test(e)), de.join('\n'));

    // ── the runtime join (engine contentParts) uses the same order as the tools ──
    const { contentParts } = await import(pathToFileURL(join(ENGINE, 'modules/content/parts.js')).href);
    const joined = contentParts({ './props/b.js': { default: [{ id: 'b' }] }, './props/a.js': { default: [{ id: 'a' }] }, './props/index.js': { default: [{ id: 'skip' }] } });
    check('contentParts joins a folder in file-name order and skips index.js', joined.map(p => p.id).join() === 'a,b', JSON.stringify(joined));
    let thrown = '';
    try { contentParts({ './t/a.js': { default: { crate: {} } }, './t/b.js': { default: { crate: {} } } }); } catch (e) { thrown = e.message; }
    check('contentParts refuses a key defined in two files', /defined in both/.test(thrown), thrown);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
