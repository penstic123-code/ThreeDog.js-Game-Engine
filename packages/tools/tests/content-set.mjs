// threedog content set: targeted edit of one content entry (content-set.mjs), no browser.
// Why a unit test: the edit must change exactly one value and keep comments / spacing, and must refuse (not guess) on generated or ambiguous entries.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planSet, lit } from '../content-set.mjs';

export const name = 'content set: edits one value in place (comments kept), adds a missing field, refuses generated / ambiguous / bad-json entries';

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'td-set-'));
  try {
    mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'main.js'), '\n');
    writeFileSync(join(dir, 'content/templates.js'), "export default { crate: { model: 'crate' }, fence: { model: 'fence' } };\n");
    writeFileSync(join(dir, 'content/props.js'), "const gen = [{ id: 'g1', template: 'crate', x: 9, z: 9 }];\nexport default [\n  { id: 'a', template: 'crate', x: 0, z: 0 },   // keep me\n  { id: 'b', template: 'fence', x: 1, z: 1, scale: gen.length },\n  { id: 'a', template: 'fence', x: 5, z: 5 },\n  ...gen,\n  { id: 'c', template: 'crate', x: 2, z: 2 },\n];\n");
    const set = (id, f, j, only) => planSet(dir, id, f, j, only);
    const err = async (...a) => (await set(...a)).error ?? '';
    check('two entries with the same id are ambiguous and name --in', /matches 2 entries/.test(await err('a', 'x', '1')));
    const b = await set('b', 'x', '12.5');
    check('replaces only the value, comment and spacing stay', !b.error && b.after === b.before.replace("x: 1, z: 1, scale", "x: 12.5, z: 1, scale"), b.error ?? b.after);
    const n = await set('b', 'place', '"home"', 'props');
    check('adds a missing field after the last property', n.after?.includes('scale: gen.length, place: \'home\' }'), n.error ?? n.after);
    check('a value built by code (scale: gen.length) is refused', /computed by code/.test(await err('b', 'scale', '2')));
    check('an entry after a spread is refused as built by code', /built by code/.test(await err('c', 'x', '3')));
    check('an unknown id lists nothing to edit', /no content entry/.test(await err('zzz', 'x', '1')));
    check('bad json is explained', /must be JSON/.test(await err('b', 'x', 'abc')));
    const t = await set('crate', 'model', '"box"');
    check('a named entry (template key) is edited when no placed entry has that id', !t.error && t.after.includes("crate: { model: 'box' }"), t.error ?? t.after);
    const m = await planSet(dir, 'b', [['x', '12'], ['place', '"home"'], ['z', '3']], undefined, 'props');
    check('several fields: one text, replaced and added in order, one change line', !m.error && m.after.includes("x: 12, z: 3, scale: gen.length, place: 'home' }") && m.change.split('; ').length === 3, m.error ?? m.after);
    const bad = await planSet(dir, 'b', [['x', '12'], ['scale', '2']], undefined, 'props');
    check('several fields are all-or-nothing: one refused field means no text', /computed by code/.test(bad.error ?? '') && !bad.after, JSON.stringify(bad.error));
    check('several fields: bad json names the field', /for z/.test((await planSet(dir, 'b', [['x', '1'], ['z', 'abc']])).error ?? ''));
    check('lit() writes content-style literals', lit({ a: [1, 'x'], 'b-c': true }) === "{ a: [1, 'x'], 'b-c': true }");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
