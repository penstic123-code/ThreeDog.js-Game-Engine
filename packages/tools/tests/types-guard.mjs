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
    check('no other errors (declarations themselves are clean)', errs.length === 4, errs.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
