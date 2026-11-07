// Second 1.0 review: each check here was a wrong result a user would trust.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOLS } from '../paths.mjs';
import { contentWrite, contentRead } from '../content-write.mjs';
import { routeModules, answer } from '../how-answer.mjs';
import { tryNext, docPath } from '../how.mjs';

export const name = '[guard] tools: pixel template, how install line, write-back with a stale index, comments kept';

const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

function game(files) {
  const dir = mkdtempSync(join(tmpdir(), 'review2-'));
  mkdirSync(join(dir, 'content/props'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
  return dir;
}

export async function run({ check }) {
  // The pixel layer overlays main.js only, so it must call the game layer's picture/index.js the way that file is written
  const main = readFileSync(join(TOOLS, 'templates/pixel/main.js'), 'utf8'), picture = readFileSync(join(TOOLS, 'templates/game/picture/index.js'), 'utf8');
  check('--pixel main.js calls createPicture as the template picture/ exports it', !(/createPicture\(engine\)/.test(main) && /export function createPicture\(\)/.test(picture)),
    'main.js: const picture = createPicture(engine); picture.materials.default; picture/index.js: createPicture() returns a module');

  // The route line of an API page writes the name without `engine.`; the module is still not core
  check('how: quests.start needs quests()', routeModules('quests.start(id: string) — Start a quest').includes('quests'));
  check('how: pickups.spawn needs pickups()', routeModules('pickups.spawn(...) returns a handle').includes('pickups'));

  // a.js grew by hand after the index was written, so the game's id u:2 is now b.js's FIRST entry; the index still says b.js starts at 1
  const stale = game({ 'content/props/a.js': `export default [\n  { id: 'p1', x: 1, template: 't' },\n];\n`, 'content/props/b.js': `export default [\n  { x: 1, template: 'u' },\n  { x: 2, template: 'u' },\n];\n`,
    'content/templates.js': `export default { t: {}, u: {} };\n` });
  await contentWrite(stale, { op: 'set', id: 'p1', fields: { x: 5 } });
  writeFileSync(join(stale, 'content/props/a.js'), `export default [\n  { id: 'p1', x: 5, template: 't' },\n  { id: 'p0', x: 7, template: 't' },\n];\n`);
  const wrote = await contentWrite(stale, { op: 'set', id: 'u:2', fields: { x: 100 } });
  const b = readFileSync(join(stale, 'content/props/b.js'), 'utf8');
  check('a write after a hand edit lands on the entry the game calls u:2', !wrote.ok || /\{ x: 100, template: 'u' \},\n  \{ x: 2,/.test(b), b);

  // A part file renamed by hand: the header of content-write.mjs promises a rebuild when the index is wrong
  const moved = game({ 'content/props/a.js': `export default [\n  { id: 'p1', x: 1, model: 'm' },\n];\n`, 'content/props/b.js': `export default [\n  { id: 'p2', x: 1, model: 'm' },\n];\n` });
  await contentWrite(moved, { op: 'set', id: 'p1', fields: { x: 5 } });
  renameSync(join(moved, 'content/props/a.js'), join(moved, 'content/props/c.js'));
  const set = await contentWrite(moved, { op: 'set', id: 'p1', fields: { x: 6 } });
  check('a renamed part file: write finds the id', set.ok, set.error);
  const read = await contentRead(moved, { id: 'p1' }).catch(e => ({ ok: false, error: 'threw ' + e.message }));
  check('a renamed part file: read finds the id', read.ok, read.error);

  const notes = game({ 'content/pickups.js': `export default [\n  {\n    id: 'a',\n    x: 1,\n    // the z comment: keep me\n    z: 2,\n    item: 'k',\n  },\n  { id: 'b', x: 2 } // second one\n];\n` });
  await contentWrite(notes, { op: 'set', id: 'a', fields: {}, unset: ['x'] });
  await contentWrite(notes, { op: 'add', kind: 'pickups', entry: { id: 'c', x: 3 } });
  const text = readFileSync(join(notes, 'content/pickups.js'), 'utf8');
  check('cutting x keeps the comment written above z', text.includes('the z comment'), text);
  check('adding after the last entry leaves its comment on it', /id: 'b', x: 2 \},? \/\/ second one/.test(text), text);

  // The running game takes the last of two equal keys, so a write to the first changes nothing and still says ok
  const dup = game({ 'content/pickups.js': `export default [\n  { id: 'a', x: 1, x: 2, item: 'k' },\n];\n` });
  const r = await contentWrite(dup, { op: 'set', id: 'a', fields: { x: 9 } }), after = await contentRead(dup, { id: 'a' });
  check('a write that says ok changes the value the file reads back', !r.ok || after.fields.x === 9, `ok, read back x=${after.fields?.x}`);

  const dupObj = game({ 'content/items.js': `export default {\n  key: { name: 'a' },\n  key: { name: 'b' },\n};\n` });
  const dr = await contentWrite(dupObj, { op: 'set', id: 'key', fields: { name: 'c' } });
  check('a key written twice in an object kind is refused by name', !dr.ok && /key is written 2 times/.test(dr.error), JSON.stringify(dr));

  // --file skips the lookup, not the index: without the right start of the file a position names another entry
  writeFileSync(join(stale, 'content/props/a.js'), `export default [\n  { id: 'p1', x: 5, template: 't' },\n];\n`);
  rmSync(join(stale, '.threedog'), { recursive: true });
  const given = await contentWrite(stale, { op: 'set', id: 'u:2', fields: { x: 200 }, file: 'content/props/b.js' });
  check('--file with no index: the position still counts from the start of the kind', given.ok && /\{ x: 200, template: 'u' \},\n\];/.test(readFileSync(join(stale, 'content/props/b.js'), 'utf8')), JSON.stringify(given));
  // a part that joins a folder moves everything after it, and no file the index names has changed
  writeFileSync(join(stale, 'content/props/a0.js'), `export default [\n  { id: 'q0', x: 0, template: 't' },\n];\n`);
  const joined = await contentRead(stale, { id: 'u:3' });
  check('a new part in a folder is seen', joined.ok && joined.fields.x === 200, JSON.stringify(joined));
  // an earlier part that does not load: the position of everything after it is unknown, so an index built without it would be wrong
  writeFileSync(join(stale, 'content/props/a.js'), `export default [\n  { id: 'p1', x: \n];\n`);
  const before = readFileSync(join(stale, 'content/props/b.js'), 'utf8'), blind = await contentWrite(stale, { op: 'set', id: 'u:3', fields: { x: 300 } });
  check('a stale index with a broken earlier part refuses, naming the file', !blind.ok && /a\.js does not load/.test(blind.error) && readFileSync(join(stale, 'content/props/b.js'), 'utf8') === before, JSON.stringify(blind));
  const blindRead = await contentRead(stale, { id: 'u:3' });
  check('a read refuses the same way, without throwing', !blindRead.ok && /a\.js does not load/.test(blindRead.error), JSON.stringify(blindRead));
  const absent = await contentRead(moved, { id: 'p1', file: 'content/props/a.js' });
  check('a read of a file that is not there answers, it does not throw', !absent.ok && /does not exist/.test(absent.error), JSON.stringify(absent));

  // Comments are the author's: a cut takes the field, its comma and its own end-of-line comment, nothing else
  const cuts = game({ 'content/pickups.js': `export default [\n  {\n    id: 'a',\n    x: 1, // x note\n    // about y\n    y: 2, /* y note */\n    // about z\n    z: 3,\n  },\n  { id: 'b', x: 1, y: 2, z: 3 },\n  { id: 'c', x: 1, /* mid */ y: 2, z: 3 },\n];\n` });
  await contentWrite(cuts, { op: 'set', id: 'a', fields: {}, unset: ['x'] });
  const cut1 = readFileSync(join(cuts, 'content/pickups.js'), 'utf8');
  check('the cut line goes whole, with its own comment', cut1.includes(`    id: 'a',\n    // about y\n`) && !cut1.includes('x note'), cut1);
  await contentWrite(cuts, { op: 'set', id: 'a', fields: {}, unset: ['y', 'z'] });
  const cut2 = readFileSync(join(cuts, 'content/pickups.js'), 'utf8');
  check('cutting the last fields keeps the comments between them', cut2.includes('about y') && cut2.includes('about z'), cut2);
  await contentWrite(cuts, { op: 'set', id: 'b', fields: {}, unset: ['y'] });
  check('no comment near: one-line entries close up as before', readFileSync(join(cuts, 'content/pickups.js'), 'utf8').includes(`{ id: 'b', x: 1, z: 3 }`));
  const tail = await contentWrite(cuts, { op: 'set', id: 'c', fields: {}, unset: ['y', 'z'] });
  check('two last fields on one line after a comment: no comma cut twice', tail.ok && (await contentRead(cuts, { id: 'c' })).fields.x === 1, JSON.stringify(tail));

  // an add into an empty list keeps what waits there
  const empty = game({ 'content/pickups.js': `export default [\n  // pickups go here\n];\n` });
  await contentWrite(empty, { op: 'add', kind: 'pickups', entry: { id: 'a', x: 1 } });
  check('adding to an empty list keeps its comment', /pickups go here\n  \{ id: 'a', x: 1 \},\n\];/.test(readFileSync(join(empty, 'content/pickups.js'), 'utf8')), readFileSync(join(empty, 'content/pickups.js'), 'utf8'));

  // a block comment open past the end of the last entry's line: a line break there would put the new entry inside the comment
  const open = game({ 'content/pickups.js': `export default [\n  { id: 'a', x: 1 }, /* two\n  lines */\n];\n` });
  await contentWrite(open, { op: 'add', kind: 'pickups', entry: { id: 'b', x: 2 } });
  check('an add never lands inside a block comment', (await contentRead(open, { id: 'b' })).ok, readFileSync(join(open, 'content/pickups.js'), 'utf8'));

  // A CRLF file stays one: an LF line in it shows as a change of every line in some editors, and the old add split a CRLF in two
  const crlf = game({ 'content/pickups.js': `export default [\r\n  { id: 'a', x: 1 }, // one\r\n  { id: 'b', x: 2 }, // two\r\n  { id: 'c', x: 3 } // three\r\n];\r\n` });
  await contentWrite(crlf, { op: 'add', kind: 'pickups', entry: { id: 'd', x: 4 } });
  await contentWrite(crlf, { op: 'remove', id: 'b' });
  const cr = readFileSync(join(crlf, 'content/pickups.js'), 'utf8');
  check('CRLF: every line ends the same after an add', !/[^\r]\n/.test(cr), JSON.stringify(cr));
  check('CRLF: a remove takes the line and its comment', !cr.includes('two') && cr.includes('{ id: \'c\', x: 3 }, // three'), JSON.stringify(cr));

  // Two edits of one write on the same spot: the undo's insert in front of a field the same write cuts
  const spot = game({ 'content/pickups.js': `export default [\n  { id: 'a', x: 1, y: 2, z: 3 },\n  { id: 'b', x: 1, y: 2 },\n];\n` });
  const inFront = await contentWrite(spot, { op: 'set', id: 'a', fields: { n: 9 }, unset: ['y'], spot: { n: 'y' } }), atTail = await contentWrite(spot, { op: 'set', id: 'b', fields: { n: 9 }, unset: ['y'], spot: { n: 'y' } });
  const got = [await contentRead(spot, { id: 'a' }), await contentRead(spot, { id: 'b' })];
  check('an insert in front of a field cut in the same write keeps both edits', inFront.ok && atTail.ok && same(got[0].fields, { id: 'a', x: 1, z: 3, n: 9 }) && same(got[1].fields, { id: 'b', x: 1, n: 9 }), JSON.stringify(got));

  // the docs a tool points at must be where this install has them
  writeFileSync(join(stale, 'main.js'), `import { createEngine } from 'threedog';
const engine = createEngine({});
`);
  const cold = await answer(stale, 'quests.start');
  check('how: a game without the module is told to install it', /Not installed: quests\(\)/.test(cold.text), cold.text.split('\n').slice(0, 3).join(' | '));
  check('how: a local variable in an example is no module', !routeModules('const water = make();\nwater.update(1);').length);
  check('how: a miss points at the docs by the path of this install', tryNext([]).includes(docPath('AI.md')), tryNext([]));

  // Every comment of an entry stays when all its fields go, with or without new ones coming
  const bare = game({ 'content/pickups.js': `export default [\n  {\n    // about a\n    id: 'a',\n    x: 1, // gone with x\n    // about y\n    y: 2,\n    // the end\n  },\n  { /* head */ id: 'b', x: 1 },\n  { // waiting\n  },\n];\n` });
  await contentWrite(bare, { op: 'set', id: 'a', fields: {}, unset: ['id', 'x', 'y'], file: 'content/pickups.js' });
  const left = readFileSync(join(bare, 'content/pickups.js'), 'utf8');
  check('every field cut: the comments stay, the field lines go', ['about a', 'about y', 'the end'].every(w => left.includes(w)) && !left.includes('gone with x') && !/\by: 2/.test(left), left);
  const swapped = await contentWrite(bare, { op: 'set', id: 'b', fields: { z: 3 }, unset: ['id', 'x'], file: 'content/pickups.js' });
  const left2 = readFileSync(join(bare, 'content/pickups.js'), 'utf8');
  check('every field replaced: the comment stays and the new field is in', swapped.ok && left2.includes('/* head */') && /z: 3/.test(left2) && !/id: 'b'/.test(left2), left2);
  rmSync(bare, { recursive: true, force: true });

  for (const d of [stale, moved, notes, dup, dupObj, cuts, empty, open, crlf, spot]) rmSync(d, { recursive: true, force: true });
}
