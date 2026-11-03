// Version pins between the repository's packages: every range that names threedog or an @threedog/* package (peer ranges of the published
// packages, the new-game template's package.json, the terrain-noise range new-game adds) must accept that package's current version here,
// and every three range must sit on the same minor.
// Why: on 0.x a caret range stops at the next minor (^0.2.0 does not accept 0.3.0), so bumping the engine without moving these pins makes
// npm refuse the published set (ERESOLVE) or makes new-game write a range that installs the old engine. Offline, reads files only.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.mjs';
import { applyDeps } from '../lib/scaffold.mjs';

export const name = 'version pins: threedog / @threedog/* ranges accept the current versions, three ranges share one minor';

/** Only the forms the repository uses: ^x.y.z and ~x.y.z (an unknown form fails, so a new form cannot slip past this check) */
export function accepts(range, version) {
  const m = /^([\^~])(\d+)\.(\d+)\.(\d+)$/.exec(range), v = version.split('.').map(Number);
  if (!m) return null;
  const [, op, ...r] = m, [a, b, c] = r.map(Number);
  const atLeast = v[0] > a || (v[0] === a && (v[1] > b || (v[1] === b && v[2] >= c)));
  // ^ on 0.x keeps the minor (npm semver), on >=1 keeps the major; ~ always keeps the minor
  const same = op === '^' && a > 0 ? v[0] === a : v[0] === a && v[1] === b;
  return atLeast && same;
}

export async function run({ check }) {
  const pkgDirs = ['packages/engine', 'packages/tools', 'packages/post-effects', 'packages/terrain-noise'];
  const pkgs = pkgDirs.filter(d => existsSync(join(ROOT, d, 'package.json'))).map(d => ({ file: `${d}/package.json`, json: JSON.parse(readFileSync(join(ROOT, d, 'package.json'), 'utf8')) }));
  const current = Object.fromEntries(pkgs.map(p => [p.json.name, p.json.version]));
  check('the four published packages are found', ['threedog', '@threedog/tools', '@threedog/post-effects', '@threedog/terrain-noise'].every(n => current[n]), JSON.stringify(current));

  const template = JSON.parse(readFileSync(join(ROOT, 'packages/tools/templates/game/package.json'), 'utf8'));
  const sources = [...pkgs.map(p => ({ file: p.file, deps: { ...p.json.dependencies, ...p.json.devDependencies, ...p.json.peerDependencies } })),
    { file: 'packages/tools/templates/game/package.json', deps: template.dependencies },
    { file: 'packages/tools/lib/scaffold.mjs (applyDeps --open-world)', deps: applyDeps({}, { openWorld: true }) },
    { file: 'package.json', deps: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).devDependencies }];

  const bad = [], threeMinors = new Set();
  for (const { file, deps } of sources) for (const [n, range] of Object.entries(deps ?? {})) {
    if (n === 'three' || n === '@types/three') { const m = /^[\^~]?(\d+\.\d+)\./.exec(range); threeMinors.add(m ? m[1] : `${file}:${range}`); continue; }
    if (!(n in current)) continue;
    const ok = accepts(range, current[n]);
    if (!ok) bad.push(`${file}: ${n}@${range} ${ok === null ? 'is not a ^ / ~ range' : `does not accept ${current[n]}`}`);
  }
  check('every threedog / @threedog/* range accepts the current version (bump them together)', bad.length === 0, bad.join(' | '));
  check('three and @types/three ranges are on one minor everywhere', threeMinors.size === 1, [...threeMinors].join(', '));
  // the checker itself: 0.x caret semantics are the whole point
  check('accepts(): ^0.2.0 takes 0.2.5 but not 0.3.0; ~0.187.0 takes 0.187.2', accepts('^0.2.0', '0.2.5') && !accepts('^0.2.0', '0.3.0') && accepts('~0.187.0', '0.187.2') && !accepts('^0.3.0', '0.2.9'));
}
