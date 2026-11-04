// Works after packaging (stage 1.10): make a production build of a game (without THREEDOG_TEST), serve dist with Node's built-in http,
// open the home page in a browser, and check the engine is ready, the console has no errors and no resource request returns 4xx/5xx (Workers, wasm, decoders and models/ paths are what most easily break after a build).
// Built with --base and served under that sub-path (SUB below). Called by run.mjs; the name contains "pack", so `npm test -- pack` runs it alone.
import { npm } from './lib/proc.mjs';
import { newGamePage } from './browser.mjs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, basename } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rel, ownViteConfig, VITE_DEFAULT_CONFIG } from './paths.mjs';
import { waitEngine } from './wait-engine.mjs';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream' };

// Built and served under a sub-path, the way a game is often deployed (recipes/61-deploy.md): an asset URL that ignores the base (a root-relative
// '/models/x.glb' no layer rewrote) is a 404 here, while at the site root it would have passed and broken only on the real server
const SUB = '/threedog-pack/';

/** Serve dist statically under SUB (not vite preview: the point is to prove the output runs on its own). Missing files return 404 with no fallback to index.html, so forgotten copies show up */
function serve(root) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!path.startsWith(SUB)) throw 0;
      let p = normalize('/' + path.slice(SUB.length));
      if (p.endsWith('\\') || p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root) || !(await stat(file)).isFile()) throw 0;
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Returns { name, results:[{label, ok, detail}] }, same format as spec results in run.mjs */
export async function packTest(dir, browser) {
  const name = `pack: dist of ${rel(dir) || basename(dir)} starts`;
  const results = [];
  const check = (label, ok, detail = '') => results.push({ label, ok: !!ok, detail });
  const env = { ...process.env }; delete env.THREEDOG_TEST;   // production build, without the test pages and test switches
  // the game's own build script when it has one (it may do more than vite build), else vite build
  const scripts = existsSync(join(dir, 'package.json')) ? JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts ?? {} : {};
  let b;
  if (scripts.build) b = npm(['run', 'build', '--', '--base', SUB], { cwd: dir, env: { ...env, MSYS_NO_PATHCONV: '1' } });
  else { const pkg = createRequire(join(dir, 'package.json')).resolve('vite/package.json');
    b = spawnSync(process.execPath, [join(pkg, '..', JSON.parse(readFileSync(pkg, 'utf8')).bin.vite), 'build', '--base', SUB, ...(ownViteConfig(dir) ? [] : ['--config', VITE_DEFAULT_CONFIG])], { cwd: dir, env, encoding: 'utf8' }); }
  check('production build succeeds', b.status === 0, (b.stdout + b.stderr).split('\n').filter(l => /error/i.test(l)).slice(0, 3).join(' | '));
  if (b.status !== 0) return { name, results };
  const { server, base } = await serve(join(dir, 'dist'));
  const errors = [], badRes = [];
  const page = await newGamePage(browser, { errors });
  page.on('response', r => { if (r.status() >= 400) badRes.push(`${r.status()} ${r.url().replace(base, '')}`); });
  page.on('requestfailed', r => badRes.push(`failed ${r.url().replace(base, '')}`));
  try {
    await page.goto(base + SUB);
    await waitEngine(page, { field: 'ready', errors });
    check('page opens, engine.ready is true', true);
    // Run a few more frames: Worker / physics / navmesh errors often only show up after startup
    await page.evaluate(() => new Promise(r => { let k = 0; const h = engine.onFrame(() => { if (++k >= 5) { h.remove(); r(); } }); }));
  } catch (e) { check('page opens, engine.ready is true', false, String(e).split('\n')[0]); }
  check('no failed resource loads (4xx/5xx)', badRes.length === 0, badRes.slice(0, 3).join(' | '));
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.close(); server.close();
  return { name, results };
}
