// Which vite config the tools give vite: the game's own (vite.config.js / .mjs / .ts ...) or, with none, the threedog preset, the same for every command.
// Why: threedog dev accepted a game with no vite config (or a .mjs one), but test, shot, capture, perf, gallery, bake and doctor hard-coded
// join(dir, 'vite.config.js'), so the same game failed to start there. All of them now ask viteOptions() in paths.mjs; the scan below keeps it so.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, TOOLS, ENGINE, rel, ownViteConfig, viteOptions } from '../paths.mjs';

export const name = 'vite config: own config of any extension or the threedog preset, one helper for every command (no hard-coded vite.config.js)';

export async function run({ check }) {
  check('the engine package uses its own vite.config.js', ownViteConfig(ENGINE) === join(ENGINE, 'vite.config.js'), String(ownViteConfig(ENGINE)));

  const dir = mkdtempSync(join(ROOT, '.threedog', 'zz-vite-cfg-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>\n');
    writeFileSync(join(dir, 'main.js'), 'new Worker(new URL("./w.js", import.meta.url), { type: "module" }); console.log("main");\n');
    writeFileSync(join(dir, 'w.js'), 'export const w = 1;\n');
    check('no config file: ownViteConfig is null', ownViteConfig(dir) === null);
    const o = await viteOptions(dir, { logLevel: 'error' });
    check('no config file: the preset, rooted at the game folder (not the process cwd), Workers as ES modules', o.configFile === false && o.root === dir && o.worker?.format === 'es' && o.logLevel === 'error', JSON.stringify({ configFile: o.configFile, root: o.root, worker: o.worker }));
    const { build } = await import('vite');
    const out = join(dir, 'dist');
    let err = '';
    try { await build({ ...o, build: { ...o.build, outDir: out, emptyOutDir: true } }); } catch (e) { err = String(e).split('\n')[0]; }
    check('no config file: vite builds the game with those options', !err && existsSync(join(out, 'index.html')), err);

    writeFileSync(join(dir, 'vite.config.mjs'), 'export default {};\n');
    check('a vite.config.mjs is the game\'s own config', ownViteConfig(dir) === join(dir, 'vite.config.mjs'));
    const m = await viteOptions(dir);
    check('own config: passed as configFile', m.configFile === join(dir, 'vite.config.mjs') && m.root === dir, JSON.stringify(m));

    // bake: a game's list is its bake.js files only, and hashing searches the game folder alone
    writeFileSync(join(dir, 'bake.js'), 'export const bake = { box: () => null };\n');
    const { keyMaker } = await import('../vite/vite-threedog-cache.js');
    const kb = keyMaker(dir);
    check("bake lists of a game are its bake.js files only, and a game's key search needs nothing outside its folder",
      JSON.stringify(kb.bakeLists()) === JSON.stringify([rel(join(dir, 'bake.js'))]) && kb({ name: 'box', src: '() => null' }).files.length > 0, JSON.stringify(kb.bakeLists()));
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // the guard: no tool builds a vite config path by hand (it would skip .mjs / .ts configs and the preset)
  const hard = [];
  const scan = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'templates') continue;
    const p = join(d, e.name);
    if (e.isDirectory()) scan(p);
    else if (/\.m?js$/.test(e.name) && p !== join(TOOLS, 'tests', 'vite-config.mjs')) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (/['"]vite\.config\.js['"]\s*\)/.test(l) && /configFile|existsSync/.test(l)) hard.push(`${relative(TOOLS, p)}:${i + 1}`); });
  } };
  scan(TOOLS);
  check('no tool hard-codes vite.config.js as its config (use viteOptions / ownViteConfig from paths.mjs)', !hard.length, hard.join(', '));
}
