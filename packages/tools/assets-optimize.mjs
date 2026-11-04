// threedog assets optimize [-w game] [--dry] [--force] [--budget MB] [--strict]
// Reads the game's source models (art/models/*.glb|gltf, never changed), writes the optimized copies to public/optimized/<name>.glb, and points the
// game at them (assets.optimized.js, imported by assets.js). Existing open-source tools do the work: @gltf-transform/cli (meshopt, prune, textures)
// and KTX-Software's `ktx` (Basis Universal encoder). Neither is needed to install threedog; a missing one fails only this command, and says which.
// Textures: one KTX2 per texture, encoded by the slot that uses it (glTF Transform's own rule): normal / occlusion / metallicRoughness are linear data
// and go UASTC, color slots go ETC1S + sRGB. After the run every output texture is read back and checked against its slot, so a normal map
// compressed as color is reported, not shipped silently (this needs ktx-parse; without it the run says the check was skipped).
// Not touched: baked lightmaps (*.lightmap). Their banding after compression is not measured yet, so they are left as baked and the report says so.
// A rerun handles only files whose content, options or tool versions changed (hash, not file time). --dry changes nothing and reports what would be saved.
import { existsSync, readdirSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { ROOT } from './paths.mjs';
import { KB, MB, modelStats } from './assets-check/stats.mjs';
import { readModel, hasReader, NO_READER } from './assets-check/read.mjs';
import { reviewMaterials } from './assets-check/materials.mjs';

const DEFAULT_BUDGET_MB = 32;   // GPU memory of one model's textures; over it is reported (a game decides the real number with --budget)
const COLOR_SLOTS = ['baseColorTexture', 'emissiveTexture'];
// KTX2 data format descriptor values (Khronos Data Format spec): color model UASTC = 166, ETC1S = 163; transfer function linear = 1, sRGB = 2
const MODEL_UASTC = 166, TRANSFER_SRGB = 2;

const mem = n => (n < 1048576 ? KB(n) : MB(n));   // small models show in KB, not 0.0 MB
/** Texture GPU bytes once the file is KTX2: block-compressed, ~1 byte per pixel, +1/3 for mips (same estimate as modelStats) */
const ktx2Gpu = t => Math.round(t.width * t.height * 4 / 3);

/** Cache key: source bytes (plus the files a .gltf points to), options and tool versions */
function sourceHash(src, toolKey) {
  const h = createHash('sha256').update(readFileSync(src));
  if (/\.gltf$/i.test(src)) {
    const j = JSON.parse(readFileSync(src, 'utf8'));
    for (const r of [...(j.buffers ?? []), ...(j.images ?? [])]) {
      const p = r.uri && !r.uri.startsWith('data:') && resolve(dirname(src), decodeURIComponent(r.uri));
      if (p && existsSync(p)) h.update(readFileSync(p));
    }
  }
  return h.update(toolKey).digest('hex');
}

/** Slot names that use a texture, found through the materials' getters (glTF Transform keeps no slot name on the link) */
function slotsOf(doc, t) {
  const slots = new Set();
  for (const m of doc.getRoot().listMaterials()) for (const [slot, get] of [['baseColorTexture', m.getBaseColorTexture], ['emissiveTexture', m.getEmissiveTexture], ['normalTexture', m.getNormalTexture],
    ['occlusionTexture', m.getOcclusionTexture], ['metallicRoughnessTexture', m.getMetallicRoughnessTexture]]) if (get.call(m) === t) slots.add(slot);
  return [...slots];
}

/**
 * Problems of a model that optimizing does not fix, found on the source: color space by slot / name, textures without UV, a second UV set that
 * a texture asks for and the mesh lacks, texture memory over the budget.
 * @returns {{ code: string, msg: string }[]}
 */
export function sourceProblems(doc, core, budgetMb, gpuAfter) {
  const out = reviewMaterials(doc, core).filter(i => i.severity === 'warn' && /color|data|shared|uv/.test(i.code)).map(i => ({ code: i.code, msg: `${i.where}: ${i.msg}` }));
  // second UV: a texture whose texCoord is 1 on a primitive that has no TEXCOORD_1 (typical: ambient occlusion or a baked light on UV2 exported without it)
  const seen = new Set();
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial();
    if (!m || p.getAttribute('TEXCOORD_1')) continue;
    const infos = [[m.getBaseColorTexture(), m.getBaseColorTextureInfo()], [m.getEmissiveTexture(), m.getEmissiveTextureInfo()], [m.getNormalTexture(), m.getNormalTextureInfo()],
      [m.getOcclusionTexture(), m.getOcclusionTextureInfo()], [m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()]];
    if (infos.some(([t, i]) => t && i.getTexCoord() === 1) && !seen.has(mesh)) {
      seen.add(mesh);
      out.push({ code: 'missing-second-uv', msg: `mesh ${mesh.getName() || '(unnamed)'}: a texture reads the second UV set (TEXCOORD_1) but the mesh has none. Add a second UV map in Blender (lightmap / AO unwrap) and export again.` });
    }
  }
  if (gpuAfter > budgetMb * 1048576) out.push({ code: 'over-budget', msg: `texture GPU memory ≈ ${MB(gpuAfter)} even as KTX2, over the ${budgetMb} MB budget. Lower the texture sizes in the source (a size is an art decision, so it is not done here) or raise --budget.` });
  return out;
}

/** Read the KTX2 header of every output texture and compare with its slot: { code, msg }[] */
export function encodingProblems(doc, ktxParse) {
  const out = [];
  for (const t of doc.getRoot().listTextures()) {
    if (t.getMimeType() !== 'image/ktx2') continue;
    const label = t.getName() || t.getURI() || '(unnamed texture)', slots = slotsOf(doc, t);
    let k; try { k = ktxParse.read(new Uint8Array(t.getImage())); } catch (e) { out.push({ code: 'bad-ktx2', msg: `texture ${label} is not a readable KTX2 file (${e.message})` }); continue; }
    const dfd = k.dataFormatDescriptor[0], uastc = dfd.colorModel === MODEL_UASTC, srgb = dfd.transferFunction === TRANSFER_SRGB;
    for (const s of slots) {
      if (s === 'normalTexture' && !uastc) out.push({ code: 'normal-compressed-as-color', msg: `normal map ${label} was encoded as color (ETC1S), which bends its directions. Use UASTC for normal maps.` });
      if (!COLOR_SLOTS.includes(s) && srgb) out.push({ code: 'data-tagged-srgb', msg: `texture ${label} is data (${s}) but its KTX2 header says sRGB.` });
      if (COLOR_SLOTS.includes(s) && !srgb) out.push({ code: 'color-tagged-linear', msg: `texture ${label} is color (${s}) but its KTX2 header says linear.` });
    }
  }
  return out;
}

/** assets.optimized.js: the pack pointing at the results; assets.js gets the import once (only when it has the usual `export default [` form) */
function pointGameAtResults(dir, models) {
  const pack = resolve(dir, 'assets.optimized.js');
  const body = `// Written by \`threedog assets optimize\` (rerun it to refresh): the optimized copies in public/optimized/. Edit the sources in art/models/, not this file.\n` +
    `export default [{ name: 'optimized', models: ${JSON.stringify(models, null, 2)} }];\n`;
  if (!existsSync(pack) || readFileSync(pack, 'utf8') !== body) writeFileSync(pack, body);
  const assets = resolve(dir, 'assets.js');
  if (!existsSync(assets)) return `no assets.js here: import ./assets.optimized.js where you call engine.assets.manifest(...)`;
  const text = readFileSync(assets, 'utf8');
  if (text.includes('assets.optimized')) return null;
  if (!/export default \[/.test(text)) return `add to assets.js: import optimized from './assets.optimized.js'; and spread ...optimized into the packs`;
  writeFileSync(assets, `import optimized from './assets.optimized.js';\n` + text.replace(/export default \[/, 'export default [...optimized, '));
  return 'assets.js now imports ./assets.optimized.js. If a model name there also appears in an older pack, keep one of them';
}

/** @returns {Promise<number>} exit code */
export async function runOptimize(dir, opt) {
  const SRC = resolve(dir, 'art/models'), OUT = resolve(dir, 'public/optimized'), STATE = resolve(dir, '.threedog');
  const dry = !!opt.dry, force = !!opt.force, strict = !!opt.strict, budget = opt.budget === undefined ? DEFAULT_BUDGET_MB : Number(opt.budget);
  if (!(budget > 0)) { console.error('✗ --budget takes a number of MB, like --budget 32'); return 1; }
  if (!existsSync(SRC)) { console.log(`${SRC} does not exist. Put the .glb / .gltf exported from Blender into art/models/ and run again.`); return 0; }
  if (!hasReader()) { console.error('✗ assets optimize needs @gltf-transform/cli: run npm i -D @gltf-transform/cli (' + NO_READER + ')'); return 1; }
  const req = createRequire(resolve(ROOT, 'package.json'));
  let cliBin; try { cliBin = resolve(dirname(req.resolve('@gltf-transform/cli')), '../bin/cli.js'); } catch { console.error('✗ assets optimize needs @gltf-transform/cli: run npm i -D @gltf-transform/cli'); return 1; }
  let ktxParse = null; try { ktxParse = req('ktx-parse'); } catch {}
  const ktx = spawnSync('ktx', ['--version'], { encoding: 'utf8' }), ktxOk = !ktx.error && ktx.status === 0;
  const ktxVersion = ktxOk ? (ktx.stdout || ktx.stderr).trim() : null;
  const ktxHow = 'Texture compression needs the `ktx` command from KTX-Software 4.3+ (Apache-2.0, https://github.com/KhronosGroup/KTX-Software/releases): install it and put it on PATH. Nothing else in threedog needs it.';

  // No texture resize (a size is an art decision); names, hierarchy and material names stay (the level module reads col_, spawn ...)
  const FLAGS = ['--compress', 'meshopt', '--texture-compress', 'ktx2', '--texture-size', '16384', '--flatten', 'false', '--join', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false'];
  const version = JSON.parse(readFileSync(resolve(dirname(cliBin), '../package.json'), 'utf8')).version;
  const toolKey = JSON.stringify({ gltfTransform: version, ktx: ktxVersion, flags: FLAGS });
  const readJson = (p, d) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return d; } };
  const cachePath = resolve(STATE, 'optimize-cache.json'), reportPath = resolve(STATE, 'optimize-report.json');
  const cache = readJson(cachePath, {}), report = readJson(reportPath, {});

  const files = readdirSync(SRC).filter(f => /\.(glb|gltf)$/i.test(f));
  if (!dry) mkdirSync(OUT, { recursive: true });
  let failed = 0, problemCount = 0, done = 0, before = 0, after = 0, gpuB = 0, gpuA = 0;
  const names = {};   // only models with a usable result: the pack must never point at a file this run could not make
  let readBackSkipped = false;
  console.log(`${dry ? 'Dry run (nothing is written): ' : ''}${files.length} model(s) in ${SRC}`);
  for (const f of files) {
    const name = basename(f, extname(f)), src = resolve(SRC, f), out = resolve(OUT, name + '.glb'), key = sourceHash(src, toolKey);
    if (!force && existsSync(out) && cache[f] === key) { console.log(`  unchanged  ${f}`); names[name] = `/optimized/${name}.glb`; continue; }
    let src0;
    try { src0 = await readModel(src); } catch (e) { console.log(`✗ ${f}: cannot read (${e.message})`); failed++; continue; }
    const s0 = modelStats(src0.doc, src0.core), hasTex = s0.textures.count > 0;
    const gpuEst = s0.textures.list.reduce((s, t) => s + ktx2Gpu(t), 0), a = statSync(src).size;
    const problems = sourceProblems(src0.doc, src0.core, budget, gpuEst);
    let s1 = null, b = null;
    if (dry) {
      console.log(`- ${f}  ${KB(a)}, ${s0.textures.count} texture(s): GPU ≈ ${mem(s0.textures.gpuBytes)} → ${mem(gpuEst)} as KTX2 (estimate); the download size is known after a real run${hasTex && !ktxOk ? '\n  ! ktx is not installed: a real run would fail on this file. ' + ktxHow : ''}`);
    } else {
      if (hasTex && !ktxOk) { console.log(`✗ ${f}: ${ktxHow}`); failed++; continue; }
      const t0 = Date.now(), r = spawnSync(process.execPath, [cliBin, 'optimize', src, out, ...FLAGS], { encoding: 'utf8' });
      if (r.status) { console.log(`✗ ${f}\n${(r.stderr || r.stdout).trim().split('\n').slice(-6).join('\n')}`); failed++; continue; }
      b = statSync(out).size;
      let res; try { res = await readModel(out); } catch (e) { console.log(`✗ ${f}: the output cannot be read back (${e.message})`); failed++; continue; }
      s1 = modelStats(res.doc, res.core);
      if (ktxParse) problems.push(...encodingProblems(res.doc, ktxParse));
      else if (hasTex && !readBackSkipped) { readBackSkipped = true; console.log('  ! KTX2 read-back check skipped: ktx-parse is not installed, so a texture encoded for the wrong slot would not be reported (npm i -D ktx-parse)'); }
      names[name] = `/optimized/${name}.glb`; cache[f] = key; before += a; after += b; done++; gpuB += s0.textures.gpuBytes; gpuA += s1.textures.gpuBytes;
      console.log(`✓ ${f}  ${KB(a)} → ${KB(b)} (${Math.round(b / a * 100)}%, ${Date.now() - t0} ms); textures ${s0.textures.count} × ${s1.textures.formats.join('+') || '-'}, GPU ≈ ${mem(s0.textures.gpuBytes)} → ${mem(s1.textures.gpuBytes)} (estimate)`);
    }
    for (const p of problems) console.log(`  ! ${p.code}: ${p.msg}`);
    problemCount += problems.length;
    report[f] = { sourceBytes: a, outputBytes: b, output: b ? `public/optimized/${name}.glb` : null, source: s0, optimized: s1, problems, dry: dry || undefined };
  }
  if (!dry) {
    mkdirSync(STATE, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 1) + '\n');
    writeFileSync(reportPath, JSON.stringify(report, null, 1) + '\n');
    // a failed run leaves the game as it was: a half list would drop models that still work, and a full one would name a file that is not there
    if (failed) console.log('\nassets.js and assets.optimized.js were not changed: fix the failed model(s) and run again.');
    else if (files.length) { const note = pointGameAtResults(dir, names); if (note) console.log('\n' + note + '.'); }
  }
  // Lightmaps are listed, not compressed
  const lm = [];
  const walk = d => { for (const e of existsSync(d) ? readdirSync(d, { withFileTypes: true }) : []) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.lightmap')) lm.push(p); } };
  walk(resolve(dir, 'public'));
  if (lm.length) console.log(`\nLightmaps left as baked (${lm.length}): banding after compression is not measured yet, so they are not compressed.`);
  if (done) console.log(`\nOptimized ${done}: ${KB(before)} → ${KB(after)}, texture GPU ≈ ${mem(gpuB)} → ${mem(gpuA)} (estimate). Originals in art/models/ are untouched.`);
  else if (!failed && !dry) console.log('\nNothing to do.');
  console.log(`${problemCount} problem(s), ${failed} failed`);
  return failed || (strict && problemCount) ? 1 : 0;
}
