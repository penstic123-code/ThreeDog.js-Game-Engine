// Compress art assets: npm run assets
// Compresses the .glb / .gltf files (original Blender exports) in art/models/ of the current workspace (a game directory, default the engine package; -w name selects) into public/models/ (same-name .glb); in the game use '/models/name.glb' as usual.
//   Geometry: Meshopt compression (the engine ships the decoder, no extra download); textures: WebP (with --ktx2 converted to KTX2, which saves video memory and needs the ktx command from KTX-Software)
//   Object names, hierarchy and materials are kept (the level module relies on names such as col_ and spawn), and nothing is simplified: it only compresses, it does not change the model.
//   Incremental: files in public newer than the source are skipped; --force redoes everything. Prints sizes before and after.
//
//   npm run assets                 compress what changed
//   npm run assets -- --ktx2       textures as KTX2
//   npm run assets -- --force      redo everything
//   npm run assets -- -w my-game  compress a game's (or run npm run assets inside the game directory)
import { readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { ROOT, pickWorkspace } from './paths.mjs';

const { dir, args } = pickWorkspace(process.argv.slice(2));
const SRC = resolve(dir, 'art/models'), OUT = resolve(dir, 'public/models');
const force = args.includes('--force');
let tex = args.includes('--ktx2') ? 'ktx2' : 'webp';
const kb = n => (n / 1024).toFixed(1) + ' KB';

if (!existsSync(SRC)) { console.log(`${SRC} does not exist. Put the .glb / .gltf exported from Blender into art/models/ and run again.`); process.exit(0); }
if (tex === 'ktx2' && spawnSync('ktx', ['--version']).error) {
  console.log('ktx command (KTX-Software) not found, using WebP for textures. To use KTX2: install https://github.com/KhronosGroup/KTX-Software and retry.');
  tex = 'webp';
}
mkdirSync(OUT, { recursive: true });
// @gltf-transform/cli is an optional peer of @threedog/tools (it pulls sharp / libvips, LGPL): installed only by projects that compress assets
let cli;
try { cli = createRequire(resolve(ROOT, 'package.json')).resolve('@gltf-transform/cli/bin/cli.js'); }
catch { console.error('✗ npm run assets needs @gltf-transform/cli: run npm i -D @gltf-transform/cli'); process.exit(1); }
const files = readdirSync(SRC).filter(f => /\.(glb|gltf)$/i.test(f));
let before = 0, after = 0, done = 0;
for (const f of files) {
  const src = resolve(SRC, f), out = resolve(OUT, basename(f, extname(f)) + '.glb');
  if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) { console.log(`  unchanged  ${f}`); continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [cli, 'optimize', src, out,
    '--compress', 'meshopt', '--texture-compress', tex,
    // Keep names and structure: no merging, no flattening, no simplifying, no palette (the level module reads col_, spawn and material names)
    '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false'], { encoding: 'utf8' });
  if (r.status) { console.log(`✗ ${f}\n${r.stderr || r.stdout}`); continue; }
  const a = statSync(src).size, b = statSync(out).size;
  before += a; after += b; done++;
  console.log(`✓ ${f}  ${kb(a)} → ${kb(b)} (${Math.round(b / a * 100)}%, ${Date.now() - t0} ms)`);
}
if (done) console.log(`\nCompressed ${done}: ${kb(before)} → ${kb(after)}`);
else console.log('\nNothing to compress.');
