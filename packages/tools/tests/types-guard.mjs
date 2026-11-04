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
import { createEngine, sky, THREE } from 'threedog';
const v = new THREE.Vector3();
v.addd(1);
v.set('1', 2, 3);
createEngine({ canvas: document.createElement('canvas'), styel: {} });
const home = new THREE.Vector3();
console.log(home[0]);
// A plain object literal (no annotation): TypeScript widens 'cumulus' to string; that must still pass. A misspelled field must still fail.
const okClouds = { kind: 'cumulus', coverage: 0.5 };
const badClouds = { coverag: 1 };
sky({ clouds: okClouds });
sky({ clouds: badClouds });
// The game's own untyped helpers (art code): TypeScript infers their parameter types, and the report must name that cause and the fix
function box({ w, rough }) { return w + rough; }
box({ w: 1 });
function tree(opts = {}) { return opts.rough ?? 0.8; }
// Plain JS TypeScript cannot follow in the game's own code (lines 16, 17 above, and 20-22): hints, never errors. An engine API typo stays an error (24); line 23 is valid
import { float } from 'three/tsl';
const fx = { time: 0 }; fx.density = 0.1;
const mat = fx.time > 0 ? new THREE.ShaderMaterial() : new THREE.MeshBasicMaterial(); console.log(mat.uniforms);
let s = float(0); s = s.add(1);
const eng = createEngine({ canvas: document.createElement('canvas') }); const fog = () => ({ name: 'fog', slot: 'hdr', create: () => ({}) }); eng.post.add(fog());
eng.post.ad(fog());
console.log(eng.random());
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
    check('unannotated options literal with a literal-union field passes (line 12)', !errs.some(l => /probe\.js:12 /.test(l)), errs.join(' | '));
    check('misspelled field in an unannotated literal still fails (line 13)', errs.some(l => /probe\.js:13 /.test(l)), errs.join(' | '));
    const hints = out.split(/\r?\n/).filter(l => l.trim().startsWith('!'));
    check('a destructured parameter without JSDoc: a hint naming the missing name, the cause and both fixes (not "expected an object/function, got an object/function")',
      hints.some(l => /probe\.js:16 .*lacks `rough`.*no JSDoc.*default in the pattern.*@param/.test(l)), hints.join(' | '));
    check('opts = {} without JSDoc: a hint saying the type came from the default {} and how to type it', hints.some(l => /probe\.js:17 .*opts\.rough.*inferred from a default `\{\}`.*@param/.test(l)), hints.join(' | '));
    check('a field added to the game\'s own object, a union from its own ternary, TSL node inference: hints, not errors',
      [20, 21, 22].every(n => hints.some(l => l.includes(`probe.js:${n} `) && l.includes('plain JS'))), hints.join(' | '));
    check('an effect returned from a function (slot widened to string) is a valid PostEffect', !errs.some(l => /probe\.js:23 /.test(l)) && !hints.some(l => /probe\.js:23 /.test(l)), errs.join(' | '));
    check('an engine API typo still fails (post.ad)', errs.some(l => /probe\.js:24 .*ad/.test(l)), errs.join(' | '));
    check('calling an object names the expression and its type (engine.random() where engine.random is a Random)', errs.some(l => /probe\.js:25 .*`eng\.random` is not a function.*Random.*`eng\.random\.<method>\(\)`/.test(l)), errs.join(' | '));
    check('no other errors (declarations themselves are clean)', errs.length === 7, errs.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
