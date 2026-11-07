// W4 "one failure shape" guards that need no browser: R45 flags a plain throw / bare console call in engine code and passes the engine as it is;
// engine errors carry their own code (so the hint table keeps only patterns for messages the engine does not write); warnOnce is the one dedupe.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';
import R45, { scanText } from '../rules/R45-failure-shape.mjs';

const eng = f => import(pathToFileURL(join(ENGINE, f)).href);
const [{ ERROR_CODES }, { ERROR_HINTS, hintFor }, { warnOnce, trackValidate }] = await Promise.all(['core/base/errorCodes.js', 'core/base/errorHints.js', 'core/base/validate.js'].map(eng));
const { sampleGrid } = await eng('core/scene/grid.js');

export const name = 'one failure shape: R45 flags plain throws / bare console in engine code, engine errors carry codes, warnOnce dedupes by key';

export async function run({ check }) {
  // the rule on fixtures: each forbidden form is a finding; the coded forms, comments and strings are not
  const bad = scanText("export function f(x) { if (!x) throw new Error('x is required'); }\nfunction g() { throw new TypeError('no'); }\nconsole.warn('careful'); console.error('broken'); console.info('fyi');\n");
  check('R45 flags throw new Error / TypeError and console.warn / error / info', bad.join() === 'throw new Error(,throw new TypeError(,console.warn(,console.error(,console.info(', bad.join());
  const ok = scanText("// throw new Error('in a comment')\nconst s = 'console.warn(x)';\nthrow codedError('grid-data', 'bad');\nwarnOnce(coded('asset-load', 'x'));\nconsole.log('fine');\n");
  check('R45 passes codedError / warnOnce, comments, strings and console.log', ok.length === 0, ok.join());
  // [guard] one dev switch: engine code reads import.meta.env only in core/base/validate.js (DEV, DEV_SERVER, BASE_URL). Why: a raw
  // import.meta.env.DEV elsewhere is off in the npm test bundle (a production build with THREEDOG_TEST), so a dev check there silently never ran under tests
  const { engineFiles, read } = await import('../rules/_lib.mjs');
  // One exception, this exact line: the bundler can drop the picture writers only behind the literal test, and they must never reach a release bundle
  const WRITERS = 'if (import.meta.env?.DEV) installPictureWriters(this);';
  const envReaders = engineFiles().filter(f => !f.endsWith('core/base/validate.js') && /^(?!\s*\/\/).*import\.meta\.env/m.test(read(f).replace(WRITERS, '')));
  check('[guard] import.meta.env is read only in core/base/validate.js (one dev-mode switch)', envReaders.length === 0, envReaders.join(', '));
  // not bypassable: the real engine has no finding left
  const found = R45.run();
  check('R45 passes on the engine as it is (0 findings)', found.length === 0, found.slice(0, 5).map(r => `${r.file}:${r.line} ${r.msg}`).join('; '));

  // [guard] data edges hold in release (design.md section 11). Node has no Vite env, so DEV is off here and these are the release branches
  const { DEV } = await eng('core/base/validate.js'), { putPos } = await eng('modules/world/pos.js'), { setRecord } = await eng('modules/world/records.js');
  const { interactions } = await eng('modules/gameplay/Interactions.js'), { contractEngine, contractCtx } = await import('@threedog/tools/contract');
  const code = fn => { try { fn(); return null; } catch (x) { return x.code; } };
  const at = { x: 1, y: 2, z: 3 }, nan = code(() => putPos('t', { x: NaN, z: 0 }, at)), short = code(() => putPos('t', [1, 2], at));
  check('[guard] release: a bad position is refused and writes nothing', !DEV && nan === 'bad-position' && short === 'bad-position' && at.x === 1 && at.z === 3, `${DEV} ${nan} ${short}`);
  const rec = { id: 'a', kind: 'k' }, idPatch = code(() => setRecord({ engine: { ops: {} }, _need: () => rec }, 'a', { id: 'b' }));
  check('[guard] release: world.set cannot change a record\'s id', idPatch === 'world-add' && rec.id === 'a', String(idPatch));
  const re = contractEngine(); let ran = 0;
  re.ops.define('edge.run', { args: { who: 'id', n: { type: 'int', min: 0 } }, run: () => { ran++; } });
  re._things = { sources: [1], source: id => id === 'known' ? {} : null };
  const refusal = a => { const r = re.ops.run('edge.run', a); return `${r.code}:${r.facts?.[0]?.field}`; };
  const refused = [refusal({ who: 'known' }), refusal({ who: 'gone', n: 1 }), refusal({ who: 'known', n: -1 }), refusal({ who: 'known', n: 1.5 })].join();
  check('[guard] release: an op refuses a missing arg, an id with no record and a number out of range before run', refused === 'badArgs:n,badArgs:who,badArgs:n,badArgs:n' && !ran, refused);
  check('[guard] release: good args still run', re.ops.run('edge.run', { who: 'known', n: 1 }).ok && ran === 1);
  const im = interactions({ pick: 'nearest' }), I = im.install(re, contractCtx(re, im.name));
  check('[guard] release: a once interaction needs a stable id of its own', code(() => I.add([0, 0, 0], { once: true })) === 'interaction-option', 'no id');

  // an engine misuse error carries its code, fix and docs; the fix is in ERROR_CODES, not guessed from the text
  let err = null;
  try { sampleGrid([1, 2, 3], { width: 2, height: 2, cellSize: 1 }); } catch (e) { err = e; }
  check('a converted throw is coded: err.code, err.fix, docs and the [code] tag', err?.code === 'grid-data' && /\[grid-data\]$/.test(err.message)
    && err.fix === ERROR_CODES['grid-data'].fix && err.docs.length > 0, String(err?.message));
  check('hintFor reads the tag, not a pattern', hintFor(err?.message)?.cause === ERROR_CODES['grid-data'].fix);

  // the hint table holds only messages the engine does not write (JavaScript / browser / three.js)
  check('hint table: only JavaScript / browser classes, none duplicating an error code', ERROR_HINTS.length <= 8 && ERROR_HINTS.every(h => !ERROR_CODES[h.id]),
    ERROR_HINTS.map(h => h.id).join(', '));

  // warnOnce: one dedupe for every engine warning; a key collapses texts with changing numbers (budget values, call sites)
  const seen = [], w0 = console.warn;
  console.warn = m => seen.push(String(m));
  try {
    warnOnce('w4 test budget 61 ms [budget-over]', 'w4-key'); warnOnce('w4 test budget 72 ms [budget-over]', 'w4-key');
    warnOnce('w4 test plain'); warnOnce('w4 test plain');
  } finally { console.warn = w0; }
  check('warnOnce: once per key, once per text', seen.length === 2 && /61 ms/.test(seen[0]), JSON.stringify(seen));
  // [guard] validate is per engine: a later engine with validate: false no longer silences the page for an engine that wants checks (it used to: last createEngine won)
  const said = [], w1 = console.warn, says = t => { const n = said.length; warnOnce(t); return said.length > n; };
  console.warn = m => said.push(String(m));
  let mixed, quietOnly, after;
  try {
    const a = trackValidate(undefined), b = trackValidate(false);
    mixed = says('w4 validate mixed'); a(); quietOnly = says('w4 validate quiet'); b(); b(); after = says('w4 validate after');
  } finally { console.warn = w1; }
  check('[guard] validate per engine: page warnings stay on while any live engine has checks on, off when only validate: false engines live',
    mixed === true && quietOnly === false && after === true, JSON.stringify({ mixed, quietOnly, after }));
}
