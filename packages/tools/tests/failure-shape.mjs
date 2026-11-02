// W4 "one failure shape" guards that need no browser: R45 flags a plain throw / bare console call in engine code and passes the engine as it is;
// engine errors carry their own code (so the hint table keeps only patterns for messages the engine does not write); warnOnce is the one dedupe.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';
import R45, { scanText } from '../rules/R45-failure-shape.mjs';

const eng = f => import(pathToFileURL(join(ENGINE, f)).href);
const [{ ERROR_CODES }, { ERROR_HINTS, hintFor }, { warnOnce, setValidate }] = await Promise.all(['core/errorCodes.js', 'core/errorHints.js', 'core/validate.js'].map(eng));
const { sampleGrid } = await eng('core/grid.js');

export const name = 'one failure shape: R45 flags plain throws / bare console in engine code, engine errors carry codes, warnOnce dedupes by key';

export async function run({ check }) {
  // the rule on fixtures: each forbidden form is a finding; the coded forms, comments and strings are not
  const bad = scanText("export function f(x) { if (!x) throw new Error('x is required'); }\nfunction g() { throw new TypeError('no'); }\nconsole.warn('careful'); console.error('broken');\n");
  check('R45 flags throw new Error / TypeError and console.warn / error', bad.join() === 'throw new Error(,throw new TypeError(,console.warn(,console.error(', bad.join());
  const ok = scanText("// throw new Error('in a comment')\nconst s = 'console.warn(x)';\nthrow codedError('grid-data', 'bad');\nwarnOnce(coded('load-failed', 'x'));\nconsole.log('fine');\n");
  check('R45 passes codedError / warnOnce, comments, strings and console.log', ok.length === 0, ok.join());
  // not bypassable: the real engine has no finding left
  const found = R45.run();
  check('R45 passes on the engine as it is (0 findings)', found.length === 0, found.slice(0, 5).map(r => `${r.file}:${r.line} ${r.msg}`).join('; '));

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
    setValidate(true);
    warnOnce('w4 test budget 61 ms [budget-over]', 'w4-key'); warnOnce('w4 test budget 72 ms [budget-over]', 'w4-key');
    warnOnce('w4 test plain'); warnOnce('w4 test plain');
  } finally { console.warn = w0; }
  check('warnOnce: once per key, once per text', seen.length === 2 && /61 ms/.test(seen[0]), JSON.stringify(seen));
}
