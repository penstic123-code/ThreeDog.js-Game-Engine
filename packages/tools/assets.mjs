// Compress art assets: npm run assets
// Compresses the .glb / .gltf files (original Blender exports) in art/models/ of the current workspace (a game directory, default the engine
// package; -w name selects) into public/models/ (same-name .glb); in the game use '/models/name.glb' as usual.
//   Geometry: Meshopt compression (the engine ships the decoder, no extra download); textures: WebP (with --ktx2 converted to KTX2, which saves
//   video memory and needs the ktx command from KTX-Software)
//   Object names, hierarchy and materials are kept (the level module relies on names such as col_ and spawn), and nothing is simplified: it only
//   compresses, it does not change the model.
//   Incremental: a file is skipped when its source content, the options and the tool versions (gltf-transform, ktx) equal those of the last
//   build (not the file time); --force redoes everything.
//   Report per file: sizes before and after, mesh / material / texture / animation counts, the final texture format, and the transfer size vs
//   GPU memory of textures (WebP shrinks the download only; just KTX2 shrinks GPU memory). Also written to <workspace>/.threedog/assets-report.json.
//
//   npm run assets                 compress what changed
//   npm run assets -- --ktx2       textures as KTX2 (without the ktx command: falls back to WebP and the report says so)
//   npm run assets -- --ktx2 --strict   fail instead of falling back
//   npm run assets -- --force      redo everything
//   npm run assets -- -w my-game  compress a game's (or run npm run assets inside the game directory)
//   npm run assets -- check [glb or folder] [--json] [--strict]   inspect without building: level manifest, material review, statistics
import { readdirSync, statSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { ROOT, pickWorkspace } from './paths.mjs';
import { KB, MB, statsLines, modelStats, textureLine } from './assets-check/stats.mjs';
import { readModel, hasReader } from './assets-check/read.mjs';

const { dir, args } = pickWorkspace(process.argv.slice(2));
if (args[0] === 'check') process.exit(await (await import('./assets-check/cli.mjs')).runCheck(dir, args.slice(1)));

const SRC = resolve(dir, 'art/models'), OUT = resolve(dir, 'public/models'), STATE = resolve(dir, '.threedog');
const force = args.includes('--force'), strict = args.includes('--strict');
const wanted = args.includes('--ktx2') ? 'ktx2' : 'webp';
let tex = wanted, note = '';

if (!existsSync(SRC)) { console.log(`${SRC} does not exist. Put the .glb / .gltf exported from Blender into art/models/ and run again.`); process.exit(0); }
const ktx = tex === 'ktx2' ? spawnSync('ktx', ['--version'], { encoding: 'utf8' }) : null;
if (ktx?.error) {
  note = 'requested KTX2 but the ktx command (KTX-Software) was not found';
  const how = 'To get KTX2: install https://github.com/KhronosGroup/KTX-Software and retry';
  if (strict) { console.error(`✗ ${note}, and --strict forbids the WebP fallback. ${how}`); process.exit(1); }
  note += ', so textures are WebP (the download shrinks, GPU memory does not)';
  console.log(`${note}. ${how}.`);
  tex = 'webp';
}
mkdirSync(OUT, { recursive: true });
// @gltf-transform/cli is an optional peer of @threedog/tools (it pulls sharp / libvips, LGPL): installed only by projects that compress assets.
// Its exports only expose dist/cli.mjs, so the bin script is found next to it.
let cli;
try { cli = resolve(dirname(createRequire(resolve(ROOT, 'package.json')).resolve('@gltf-transform/cli')), '../bin/cli.js'); }
catch { console.error('✗ npm run assets needs @gltf-transform/cli: run npm i -D @gltf-transform/cli'); process.exit(1); }

// Conservative options: keep names and structure, no merging, flattening, simplifying or palette (the level module reads col_, spawn, material names)
const FLAGS = ['--compress', 'meshopt', '--texture-compress', tex, '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false'];
const version = JSON.parse(readFileSync(resolve(dirname(cli), '../package.json'), 'utf8')).version;
const toolKey = JSON.stringify({ gltfTransform: version, ktx: ktx?.stdout?.trim() ?? null, flags: FLAGS });
// The cache key covers the source bytes (and the files a .gltf points to), the options and the tool versions: an edit that keeps the file time,
// a git checkout or a tool upgrade is noticed, which a time comparison misses
const sourceHash = src => {
  const h = createHash('sha256').update(readFileSync(src));
  if (/\.gltf$/i.test(src)) {
    const j = JSON.parse(readFileSync(src, 'utf8'));
    for (const r of [...(j.buffers ?? []), ...(j.images ?? [])]) {
      const p = r.uri && !r.uri.startsWith('data:') && resolve(dirname(src), decodeURIComponent(r.uri));
      if (p && existsSync(p)) h.update(readFileSync(p));
    }
  }
  return h.update(toolKey).digest('hex');
};
const cachePath = resolve(STATE, 'assets-cache.json'), reportPath = resolve(STATE, 'assets-report.json');
const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
const cache = readJson(cachePath, {}), report = readJson(reportPath, {});
const statsOf = async p => {
  if (!hasReader()) return null;
  try { const { doc, core } = await readModel(p); return modelStats(doc, core); } catch { return null; }
};

let before = 0, after = 0, done = 0, gpu = 0;
for (const f of readdirSync(SRC).filter(f => /\.(glb|gltf)$/i.test(f))) {
  const src = resolve(SRC, f), out = resolve(OUT, basename(f, extname(f)) + '.glb'), key = sourceHash(src);
  if (!force && existsSync(out) && cache[f] === key) { console.log(`  unchanged  ${f}`); continue; }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [cli, 'optimize', src, out, ...FLAGS], { encoding: 'utf8' });
  if (r.status) { console.log(`✗ ${f}\n${r.stderr || r.stdout}`); continue; }
  const a = statSync(src).size, b = statSync(out).size, [s0, s1] = [await statsOf(src), await statsOf(out)];
  before += a; after += b; done++; cache[f] = key;
  console.log(`✓ ${f}  ${KB(a)} → ${KB(b)} (${Math.round(b / a * 100)}%, ${Date.now() - t0} ms)`);
  if (s1) {
    for (const l of statsLines(s1)) console.log(l);
    if (s1.textures.count) console.log(textureLine(s0, s1, tex !== wanted));
    gpu += s1.textures.gpuBytes;
  }
  report[f] = { sourceBytes: a, outputBytes: b, textureRequested: wanted, textureFinal: s1?.textures.formats ?? null, ...(note && { note }), source: s0, output: s1 };
}
mkdirSync(STATE, { recursive: true });
writeFileSync(cachePath, JSON.stringify(cache, null, 1) + '\n');
writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
if (done) console.log(`\nCompressed ${done}: ${KB(before)} → ${KB(after)}${gpu ? `, texture GPU memory ≈ ${MB(gpu)} (estimate)` : ''}${note ? `\n! ${note}.` : ''}`);
else console.log('\nNothing to compress.');
