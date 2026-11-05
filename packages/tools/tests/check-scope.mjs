// Scoped check: `threedog check -w <game>` (also what new-game runs) reads only that game; another broken game neither fails it nor costs it time.
// Why it does not read them: an AI runs check constantly, and tsc over every game plus R18 over every engine doc was a minute spent on results that were thrown away.
// Why: new-game used to run the repo-wide check, so a clean new game "failed" on dozens of type errors from other games.
// Fixture: two throwaway games under games/ (one with a type error and a direct material, which games may use, one clean), removed afterwards.
// Run: threedog test "scoped check"
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GAMES, TOOLS, ROOT } from '../paths.mjs';
import { docFiles } from '../rules/R18-doc-refs.mjs';

export const name = 'scoped check: check -w <game> reads and reports only that game';

const CLI = join(TOOLS, 'bin', 'threedog.mjs');
const game = (dir, main) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `@threedog/${dir.split(/[\\/]/).pop()}`, private: true, type: 'module', dependencies: { threedog: '*' } }, null, 2) + '\n');
  writeFileSync(join(dir, 'index.html'), '<!doctype html><canvas id="c"></canvas><script type="module" src="./main.js"></script>\n');
  writeFileSync(join(dir, 'main.js'), main);
};
const cli = (...args) => { const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };

export async function run({ check }) {
  const clean = join(GAMES, 'zz-scope-clean'), broken = join(GAMES, 'zz-scope-broken');
  // The repo may hold no game at all (no games/ folder): a games/ this test created is removed again, so no empty folder is left behind
  const hadGames = existsSync(GAMES);
  try {
    game(clean, `// Scoped-check fixture: a clean game\nimport { createEngine } from 'threedog';\n\ncreateEngine({ canvas: document.querySelector('canvas') });\n`);
    game(broken, `// Scoped-check fixture: a broken game\nimport { createEngine, THREE } from 'threedog';\n\ncreateEngine({ canvas: document.querySelector('canvas'), styel: {} });\nexport const m = new THREE.MeshBasicMaterial();\n`);
    for (const d of ['games/zz-scope-clean', 'games/zz-scope-broken']) cli('map', '-w', d);

    const ok = cli('check', '-w', 'games/zz-scope-clean');
    const tail = ok.out.split(/\r?\n/).slice(-6).join(' | ');
    check('the clean game passes (exit 0) although the other one is broken', ok.code === 0, tail);
    check('no line names the broken game', !/zz-scope-broken/.test(ok.out), ok.out.split(/\r?\n/).filter(l => /zz-scope-broken/.test(l)).slice(0, 3).join(' | '));
    const config = JSON.stringify(JSON.parse(readFileSync(join(ROOT, '.threedog', 'tsconfig.games-zz-scope-clean.json'), 'utf8')).include);
    check('[guard] tsc is given this game and no other', config.includes('games/zz-scope-clean/') && !config.includes('games/*') && !config.includes('examples'), config);
    writeFileSync(join(clean, 'DESIGN.md'), '# clean\n');
    const docs = docFiles({ notEngine: true, dir: clean });
    check('[guard] R18 reads this game\'s docs and no engine doc', docs.length === 1 && docs[0].endsWith('zz-scope-clean/DESIGN.md'), docs.slice(0, 3).join(', '));
    check('types ran for the clean game only', /Type check: 1 game files \(games\/zz-scope-clean\)/.test(ok.out), ok.out.match(/Type check:.*/)?.[0]);

    const bad = cli('check', '-w', 'games/zz-scope-broken');
    check('the broken game fails on its own errors', bad.code === 1, bad.out.split(/\r?\n/).slice(-6).join(' | '));
    check('its type error is printed; a direct material is no error in a game', /zz-scope-broken\/main\.js:4 .*styel/.test(bad.out) && !/main\.js:5 .*material directly/.test(bad.out));
  } finally {
    rmSync(clean, { recursive: true, force: true });
    rmSync(broken, { recursive: true, force: true });
    if (!hadGames && existsSync(GAMES) && !readdirSync(GAMES).length) rmdirSync(GAMES);
  }
}
