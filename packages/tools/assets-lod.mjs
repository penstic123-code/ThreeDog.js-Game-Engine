// Lower-detail levels for `threedog assets optimize --lod`: public/optimized/<name>.lod1.glb, .lod2.glb, drawn by engine.assets.lod() or a prop's `lod: true`.
// Why they are made from the OPTIMIZED file and not the source: the engine pairs each low mesh with the full mesh by order, so both must have the same nodes
// and primitives; the optimize step may drop or reorder some. Same reason nothing here prunes nodes or removes an emptied primitive.
// Why a level file holds geometry only: a copy of the textures in every level would cost the download and the GPU memory LOD set out to save. The engine
// gives each low mesh the material of its full mesh, so a level can never drift from the game's look.
// Why a separate file and not extra nodes in the main file: a game that did not opt in would download them, and three.js would draw them on top of the model.
// Why not MSFT_lod: GLTFLoader does not read it, so the extra nodes would be plain nodes again.
// Skipped, with the reason in the report: skinned, morphing and animated models (a static level cannot follow the clip) and small models (no triangles to save).
// meshoptimizer's simplifier weighs positions and UVs: normals and UVs of the kept vertices stay as they were, nothing is recomputed. Vertices split at a UV seam or
// hard edge stay split, which keeps textures right and also limits how far a level can go; a level that saves too little is dropped and the report says so.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readdirSync, unlinkSync } from 'node:fs';
import { ROOT } from './paths.mjs';
import { readModel } from './assets-check/read.mjs';

export const DEFAULT_RATIOS = [0.5, 0.2];
const MIN_TRIANGLES = 1000;   // below this a level saves less than its extra file and switch cost
const MIN_SAVING = 0.9;       // a level must be under 90% of the one before, else it only adds a download and a visible switch
// Largest shape error per level, as a fraction of the part's size. Why a bound and not the ratio alone: the ratio alone would tear a hard-surface model to reach
// its number. Higher levels are seen from further away, so they may move a surface more.
const levelError = i => 0.01 * 3 ** i;
const UV_WEIGHTS = [0.5, 0.5];   // how much a UV change counts against a position change; the value gltfpack uses
const TRIANGLES = 4;          // glTF primitive mode

/** Triangles of a glTF Transform document, each mesh counted once */
export function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() === TRIANGLES) n += ((p.getIndices() ?? p.getAttribute('POSITION'))?.getCount() ?? 0) / 3;
  }
  return Math.round(n);
}

/** Why this model gets no levels, or null when it does */
export function lodSkipReason(doc) {
  const root = doc.getRoot();
  if (root.listSkins().length) return 'skinned: a static level cannot follow the bones';
  if (root.listMeshes().some(m => m.listPrimitives().some(p => p.listTargets().length))) return 'has morph targets: a simplified mesh no longer matches them';
  if (root.listAnimations().length) return 'animated: a level would not follow the clip';
  if (root.listNodes().some(n => n.getExtension('EXT_mesh_gpu_instancing'))) return 'GPU-instanced: already drawn as instances';
  const t = triangleCount(doc);
  return t < MIN_TRIANGLES ? `already small (${t} triangles)` : null;
}

/** --lod-shares value -> shares of the full triangles, going down; true = the defaults (bare --lod) */
export function parseRatios(v) {
  if (v === true) return DEFAULT_RATIOS;
  const r = String(v).split(',').map(Number);
  if (r.some((x, i) => !(x > 0 && x < 1) || (i && x >= r[i - 1]))) throw new Error(`--lod-shares takes falling shares of the triangles between 0 and 1, like --lod-shares 0.5,0.2 (got ${v})`);
  return r;
}

/** Remove the level files of a model (a rerun may make fewer levels, or none) */
export function dropLevels(outDir, name) {
  for (const f of readdirSync(outDir)) if (f.startsWith(name) && /^\.lod\d+\.glb$/.test(f.slice(name.length))) unlinkSync(resolve(outDir, f));
}

/**
 * The simplifier glTF Transform calls, weighing UVs too. Why: position alone collapses a flat panel whose texture is detailed, which bends the picture on it. It helps, it does not
 * cure: on a real helmet at 20% of the triangles a dome pattern came back, a round dial stayed a half moon. Reads the attribute at call time: simplifyPrimitive may compact first.
 */
const seeingUvs = (p, S) => ({
  simplify(indices, positions, stride, target, error, flags) {
    const uv = p.getAttribute('TEXCOORD_0');
    if (!uv || uv.getCount() * 3 !== positions.length) return S.simplify(indices, positions, stride, target, error, flags);
    const data = new Float32Array(uv.getCount() * 2), t = [0, 0];
    for (let i = 0; i < uv.getCount(); i++) data.set(uv.getElement(i, t), i * 2);
    return S.simplifyWithAttributes(indices, positions, stride, data, 2, UV_WEIGHTS, null, target, error, flags);
  },
});

/** Simplify in place; a primitive that would vanish keeps its triangles, so the order the engine pairs by holds */
function simplifyAll(doc, fns, simplifier, ratio, error) {
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    if (p.getMode() !== TRIANGLES) continue;
    const keep = p.clone();
    fns.simplifyPrimitive(p, { simplifier: seeingUvs(p, simplifier), ratio, error });
    if (!p.getIndices()?.getCount()) p.copy(keep);
    keep.dispose();
  }
}

/** Geometry only: no material, no texture, and no leftover claim to need a texture extension */
function stripLook(doc) {
  const root = doc.getRoot();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  for (const x of root.listExtensionsUsed()) if (!['EXT_meshopt_compression', 'KHR_mesh_quantization'].includes(x.extensionName)) x.dispose();
}

/**
 * Write the levels of one optimized model.
 * @returns {Promise<{ triangles: number[], files: string[], note: string | null }>} triangles[0] is the full model; files are `<name>.lodN.glb`
 */
export async function buildLevels(optimizedPath, outDir, name, ratios) {
  const req = createRequire(resolve(ROOT, 'package.json'));
  const fns = req('@gltf-transform/functions'), core = req('@gltf-transform/core'), gx = req('@gltf-transform/extensions');
  const { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } = req('meshoptimizer');
  await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new core.NodeIO().registerExtensions(gx.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const triangles = [triangleCount((await readModel(optimizedPath)).doc)], files = [];
  let note = null;
  for (const [i, ratio] of ratios.entries()) {
    const { doc } = await readModel(optimizedPath);   // each level starts from the full mesh, so errors do not add up from level to level
    doc.setLogger(new core.Logger(core.Logger.Verbosity.WARN));   // the report has one line per model; prune's own log lines would bury it
    stripLook(doc);
    await doc.transform(fns.weld());   // the simplifier only joins what is welded (glTF Transform's own advice); a vertex whose UV or normal differs stays split
    simplifyAll(doc, fns, MeshoptSimplifier, ratio, levelError(i));
    await doc.transform(fns.prune({ propertyTypes: [core.PropertyType.ACCESSOR], keepAttributes: true, keepLeaves: true }));
    const t = triangleCount(doc), last = triangles[triangles.length - 1];
    if (t > last * MIN_SAVING) { note = `level ${i + 1} stopped at ${t} triangles (asked ${Math.round(triangles[0] * ratio)}): seams, hard edges or the error limit hold it there`; break; }
    const file = `${name}.lod${i + 1}.glb`;
    await io.write(resolve(outDir, file), doc);
    triangles.push(t); files.push(file);
  }
  return { triangles, files, note };
}
