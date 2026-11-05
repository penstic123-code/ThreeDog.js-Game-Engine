// Fuzz (fast-check) for the editor's content writer, no browser: hand-written files with comments and odd formatting must never lose a byte
// the write was not asked to change, and a broken or truncated file must give a refusal, never a throw or a half-written file.
// Fixed seed so the normal suite is repeatable; FC_RUNS=500 FC_SEED=<n> for the long run (see docs/plans/release-checklist.md).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseAst } from 'vite';
import { contentWrite, contentRead, lit } from '../content-write.mjs';
import { checkGame } from '../content-check.mjs';

export const name = 'fuzz: content writer keeps every byte it was not asked to change (odd hand-written files), refuses broken files without throwing';

let fc = null;
try { fc = await import('fast-check'); } catch { /* skipped in run() */ }
const RUNS = Number(process.env.FC_RUNS) || 12, SEED = process.env.FC_SEED != null ? Number(process.env.FC_SEED) : 20261105;

// a gap is anything legal between two tokens: spaces, newlines (LF and CRLF), tabs, both comment forms
const gapArb = () => fc.constantFrom('', ' ', '  ', '\n', '\r\n  ', '\t', ' /* c */ ', ' // note\n', '\n// x, y: { }\n', ' /* a\n b */');
const numArb = () => fc.constantFrom('0', '1', '-2', '3.5', '1e3', '.5', '0x10', '-0.25');

/** One entry: its text and where the value of x sits in it */
const entryArb = i => fc.record({ g: fc.array(gapArb(), { minLength: 8, maxLength: 8 }), q: fc.boolean(), x: numArb(), z: numArb(), tc: fc.boolean(), sq: fc.boolean() }).map(r => {
  const k = n => (r.q ? `'${n}'` : n), s = v => (r.sq ? `'${v}'` : `"${v}"`);
  const pre = `{${r.g[0]}${k('id')}${r.g[1]}:${r.g[2]}${s('e' + i)},${r.g[3]}${k('template')}: ${s('crate')},${r.g[4]}${k('x')}${r.g[5]}:${r.g[6]}`;
  return { text: pre + r.x + `,${r.g[7]}${k('z')}: ${r.z}${r.tc ? ',' : ''} }`, xAt: pre.length, xLen: r.x.length };
});

const fileArb = () => fc.integer({ min: 1, max: 4 }).chain(n => fc.tuple(fc.tuple(...Array.from({ length: n }, (_, i) => entryArb(i))), fc.array(gapArb(), { minLength: n + 1, maxLength: n + 1 }), fc.constantFrom('export default', 'export default /* top */')))
  .map(([es, gaps, head]) => {
    let text = `${head} [${gaps[0]}`; const at = [];
    es.forEach((e, i) => { at.push(text.length + e.xAt); text += e.text + (i < es.length - 1 ? ',' : '') + gaps[i + 1]; });
    return { text: text + '];\n', at, len: es.map(e => e.xLen) };
  });

const subsequence = (small, big) => { let i = 0; for (let j = 0; j < big.length && i < small.length; j++) if (big[j] === small[i]) i++; return i === small.length; };
const parses = text => { try { parseAst(text); return true; } catch { return false; } };

async function game(root, n, text) {
  const dir = join(root, 'g' + n);
  mkdirSync(join(dir, 'content'), { recursive: true });
  writeFileSync(join(dir, 'main.js'), '\n');
  writeFileSync(join(dir, 'content/templates.js'), "export default { crate: { model: 'crate' } };\n");
  writeFileSync(join(dir, 'content/props.js'), text);
  try { await checkGame(dir); } catch { /* a broken file: the writer has to cope with that itself */ }
  return dir;
}

export async function run({ check }) {
  if (!fc) { check('fuzz: fast-check missing (skipped)', true); return; }
  const root = mkdtempSync(join(tmpdir(), 'td-fuzz-')); let n = 0;
  // One case gets FC_CASE_MS (default 30 s): over that is a reported failure with its input, not a silent wait. A synchronous loop in this process cannot be cut by a timer; FC_TRACE=1 prints each input before it runs, so the last line names the case that never came back.
  const CASE_MS = Number(process.env.FC_CASE_MS) || 30000;
  const report = async (label, arb, body) => {
    let n = 0;
    const r = await fc.check(fc.asyncProperty(arb, async v => {
      const no = ++n; let timer;
      if (process.env.FC_TRACE) console.log(`  [${label.slice(0, 20)}] case #${no} ${JSON.stringify(v)}`);
      const limit = new Promise(res => { timer = setTimeout(() => res(`HANG: case #${no} took over ${CASE_MS} ms; input ${JSON.stringify(v)}`), CASE_MS); });
      try { const bad = await Promise.race([body(v), limit]); if (bad) throw new Error(bad); } finally { clearTimeout(timer); }
    }), { numRuns: RUNS, seed: SEED });
    check(label + (r.failed ? '' : ` (${r.numRuns} cases)`), !r.failed, r.failed ? `${r.errorInstance?.message ?? r.error}\n  shrunk: ${JSON.stringify(r.counterexample)}\n  seed: ${r.seed}  path: ${r.counterexamplePath}` : '');
  };
  try {
    {   // [guard] cases the fuzz found: NaN / Infinity / undefined were written as code (`label: NaN`) and read back as "computed"; a raw \r broke the parse
      const T = 'export default [{ id: "e0", template: "crate", x: 0, z: 0 }];\n', dir = await game(root, n++, T), path = join(dir, 'content/props.js');
      const bad = [];
      for (const v of [NaN, Infinity, undefined, () => 1, 10n, { a: { b: NaN } }]) { const r = await contentWrite(dir, { op: 'set', id: 'e0', fields: { label: v } }); if (r.ok || !/content file holds/.test(r.error ?? '') || readFileSync(path, 'utf8') !== T) bad.push(String(v) + ': ' + (r.error ?? 'written')); }
      check('[guard] a value that is not data (NaN, Infinity, undefined, function, bigint, nested) is refused by name, nothing written', !bad.length, bad.join(' | '));
      const cr = await contentWrite(dir, { op: 'set', id: 'e0', fields: { label: 'a\rb', z: -0 } }), back = await contentRead(dir, { id: 'e0' });
      check('[guard] a string with a carriage return and -0 are written and read back as they were', cr.ok && back.fields.label === 'a\rb' && Object.is(back.fields.z, -0), cr.error ?? JSON.stringify(back));
    }
    await report('set changes only the value of x: the file is the old one with that one span replaced', fc.tuple(fileArb(), fc.nat(9), fc.oneof(fc.integer({ min: -999, max: 999 }), fc.double({ noNaN: true, noDefaultInfinity: true }))), async ([f, pick, v]) => {
      const dir = await game(root, n++, f.text), i = pick % f.at.length, path = join(dir, 'content/props.js');
      const r = await contentWrite(dir, { op: 'set', id: 'e' + i, fields: { x: v } });
      if (!r.ok) return `set refused a valid file: ${r.error}`;
      const want = f.text.slice(0, f.at[i]) + lit(v) + f.text.slice(f.at[i] + f.len[i]);
      return readFileSync(path, 'utf8') === want ? null : `bytes outside the value changed:\n${JSON.stringify(readFileSync(path, 'utf8'))}\n${JSON.stringify(want)}`;
    });
    await report('add keeps every old byte in order; remove then restore gives back the exact bytes', fc.tuple(fileArb(), fc.nat(9)), async ([f, pick]) => {
      const dir = await game(root, n++, f.text), i = pick % f.at.length, path = join(dir, 'content/props.js');
      const a = await contentWrite(dir, { op: 'add', kind: 'props', entry: { id: 'new1', template: 'crate', x: 1, z: 2 } });
      if (!a.ok) return `add refused a valid file: ${a.error}`;
      const added = readFileSync(path, 'utf8');
      if (!subsequence(f.text, added)) return 'add lost or reordered bytes of the old file: ' + JSON.stringify(added);
      const r = await contentWrite(dir, { op: 'remove', id: 'e' + i });
      if (!r.ok) return `remove refused: ${r.error}`;
      const re = await contentWrite(dir, { op: 'restore', id: 'e' + i, ...r.restore });
      if (!re.ok) return `restore refused: ${re.error}`;
      return readFileSync(path, 'utf8') === added ? null : 'remove + restore changed bytes';
    });
    await report('any JSON value written to a field reads back equal (odd strings, nested, -0, huge); a value that cannot be written is refused with a message and the file is untouched', fc.tuple(fileArb(), fc.oneof(fc.jsonValue().filter(v => v !== null), fc.string({ unit: 'binary' }), fc.constantFrom(-0, 1e300, 5e-324))), async ([f, v]) => {
      const dir = await game(root, n++, f.text), path = join(dir, 'content/props.js');
      let r; try { r = await contentWrite(dir, { op: 'set', id: 'e0', fields: { label: v } }); } catch (e) { return `set threw: ${e.message}`; }
      const now = readFileSync(path, 'utf8');
      if (!r.ok) return r.error && now === f.text ? null : `refused (${r.error}) but ${now === f.text ? 'no message' : 'the file changed'}`;
      const back = await contentRead(dir, { id: 'e0' });
      const same = (a, b) => Object.is(a, b) || (a && b && typeof a === 'object' && typeof b === 'object' && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => same(a[k], b[k])));
      return back.ok && same(back.fields.label, v) ? null : `wrote ${JSON.stringify(v)} (${String(v)}) but read back ${JSON.stringify(back.fields?.label)}: ${back.error ?? ''}`;
    });
    await report('a truncated or mangled file gets a refusal or a valid write, never a throw, a silent no-message refusal or a file that no longer parses', fc.tuple(fileArb(), fc.nat(500), fc.constantFrom('cut', 'junk', 'swap')), async ([f, at, how]) => {
      const p = at % f.text.length, text = how === 'cut' ? f.text.slice(0, p) : how === 'junk' ? f.text.slice(0, p) + '}{)' + f.text.slice(p) : f.text.slice(0, p) + f.text.slice(p + 1) + f.text[p];
      const dir = await game(root, n++, text), path = join(dir, 'content/props.js');
      for (const req of [{ op: 'set', id: 'e0', fields: { x: 5 } }, { op: 'remove', id: 'e0' }, { op: 'add', kind: 'props', entry: { id: 'zz', template: 'crate', x: 1, z: 1 } }]) {
        let r; try { r = await contentWrite(dir, req); } catch (e) { return `${req.op} threw: ${e.message}`; }
        const now = readFileSync(path, 'utf8');
        if (r.ok) { if (parses(text) && !parses(now)) return `${req.op} ok but the file no longer parses`; }
        else if (!r.error) return `${req.op} refused without a message`;
        else if (now !== text) return `${req.op} refused (${r.error}) but the file changed`;
        writeFileSync(path, text);   // each op starts from the same bytes
      }
      return null;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
