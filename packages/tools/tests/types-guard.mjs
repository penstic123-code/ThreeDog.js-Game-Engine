// Types guard: `threedog types` must catch real three.js misuse and engine option typos.
// Why: three used to be typed as any (a shim), and the tsc output parser silently dropped every Windows \r\n line, so the check passed no matter what.
// Writes a probe with three known mistakes under .threedog/ (gitignored), checks it with types.mjs --project, expects exactly those errors (the three.js types are real @types/three, not any; noImplicitAny stays on only for numeric indexing).
// Run: npm test -- "types guard"
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../paths.mjs';

export const name = 'types guard: threedog types catches three.js and engine-option mistakes';

const PROBE = `// @ts-check
import { createEngine, THREE } from 'threedog';
const v = new THREE.Vector3();
v.addd(1);
v.set('1', 2, 3);
createEngine({ canvas: document.createElement('canvas'), styel: {} });
const home = new THREE.Vector3();
console.log(home[0]);
// A plain object literal (no annotation): TypeScript widens 'texture' / 'mix' / a [[t, v]] list; that must still pass. A misspelled field must still fail.
const okStyle = { terrain: { config: { shading: 'texture' } }, seasons: { mode: 'mix' }, exposure: [[0, 1.6], [0.5, 1]], post: [{ name: 'x', slot: 'ldr' }] };
const badStyle = { exposur: 1 };
createEngine({ canvas: document.createElement('canvas'), style: okStyle });
createEngine({ canvas: document.createElement('canvas'), style: badStyle });
// The game's own untyped helpers (art code): TypeScript infers their parameter types, and the report must name that cause and the fix
function box({ w, rough }) { return w + rough; }
box({ w: 1 });
function tree(opts = {}) { return opts.rough ?? 0.8; }
`;

export async function run({ check }) {
  const dir = join(ROOT, '.threedog', 'types-probe');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, 'probe.js'), PROBE);
    // exclude is reset: the root config excludes **/.threedog
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: '../../tsconfig.json', include: ['probe.js'], exclude: [] }));
    const r = spawnSync(process.execPath, [join(ROOT, 'packages', 'tools', 'types.mjs'), '--project', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const errs = out.split(/\r?\n/).filter(l => l.trim().startsWith('✗'));
    check('fails (exit code not 0)', r.status !== 0, out.slice(0, 200));
    check('three.js method typo: v.addd', errs.some(l => /probe\.js:4 .*addd/.test(l)), errs.join(' | '));
    check('three.js vector argument type: v.set(\'1\', …)', errs.some(l => /probe\.js:5 .*expected number/.test(l)), errs.join(' | '));
    check('engine option typo: styel', errs.some(l => /probe\.js:6 .*styel/.test(l)), errs.join(' | '));
    check('numeric index on a Vector3: home[0] (any would silently turn into NaN)', errs.some(l => /probe\.js:8 .*numeric index/.test(l)), errs.join(' | '));
    check('unannotated style literal with literal-union fields passes (line 12)', !errs.some(l => /probe\.js:12 /.test(l)), errs.join(' | '));
    check('misspelled style field still fails (line 13)', errs.some(l => /probe\.js:13 /.test(l)), errs.join(' | '));
    check('a destructured parameter without JSDoc: names the missing name, the cause and both fixes (not "expected an object/function, got an object/function")',
      errs.some(l => /probe\.js:16 .*lacks `rough`.*no JSDoc.*default in the pattern.*@param/.test(l)), errs.join(' | '));
    check('opts = {} without JSDoc: says the type came from the default {} and how to type it', errs.some(l => /probe\.js:17 .*opts\.rough.*inferred from a default `\{\}`.*@param/.test(l)), errs.join(' | '));
    check('no other errors (declarations themselves are clean)', errs.length === 7, errs.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
