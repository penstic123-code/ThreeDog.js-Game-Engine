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
    check('an unknown id is explained', /no content entry with id 'zzz'/.test((await w({ op: 'set', id: 'zzz', fields: { x: 1 } })).error ?? ''));
    const t = await w({ op: 'set', id: 'crate', fields: { model: 'box' } });
    check('a named entry (template key) is edited when no placed entry has that id', t.ok && readFileSync(join(dir, 'content/templates.js'), 'utf8').includes("crate: { model: 'box' }"), t.error);

    const a = await w({ op: 'add', kind: 'props', entry: { id: 'd', template: 'crate', x: 5, z: 5 } });
    check('add appends after the last literal on its own line, trailing comma kept', a.ok && props().includes("  ...gen,\n  { id: 'd', template: 'crate', x: 5, z: 5 },\n];"), a.error ?? props());
    check('add without an id is refused (a position id shifts)', /needs an id/.test((await w({ op: 'add', kind: 'props', entry: { template: 'crate', x: 1, z: 1 } })).error ?? ''));
    check('add with an id that exists is refused', /already used/.test((await w({ op: 'add', kind: 'props', entry: { id: 'a', template: 'crate', x: 1, z: 1 } })).error ?? ''));
    const r = await w({ op: 'remove', id: 'a' });
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
