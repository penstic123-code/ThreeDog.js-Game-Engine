// WebAssembly texture encoder for `assets optimize`, used when the `ktx` program (KTX-Software) is not on PATH.
// ktx2-encoder (MIT) bundles the Basis Universal encoder as wasm (Apache-2.0), so it installs with these tools: no installer, no PATH.
// glTF Transform's own `ktx2` step can only run an external program; ktx2-encoder's gltf-transform helper takes ONE option set for every texture,
// which would compress a normal map as color. So the slot rule lives here, one texture at a time.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './paths.mjs';

export const WASM_HOW = 'Texture compression needs either the `ktx` command (KTX-Software 4.3+) on PATH or the npm package ktx2-encoder: run npm i -D ktx2-encoder (it carries the encoder as WebAssembly, no other install).';

/** Slot names that use a texture, found through the materials' getters (glTF Transform keeps no slot name on the link) */
export function textureSlots(doc, t) {
  const slots = new Set();
  for (const m of doc.getRoot().listMaterials()) for (const [slot, get] of [['baseColorTexture', m.getBaseColorTexture], ['emissiveTexture', m.getEmissiveTexture], ['normalTexture', m.getNormalTexture],
    ['occlusionTexture', m.getOcclusionTexture], ['metallicRoughnessTexture', m.getMetallicRoughnessTexture]]) if (get.call(m) === t) slots.add(slot);
  return [...slots];
}

/** Encoder options for a slot list. Any data slot wins: a texture shared by color and data is encoded as data (the source check already warns about sharing). */
export function optionsForSlots(slots) {
  const data = slots.some(s => s !== 'baseColorTexture' && s !== 'emissiveTexture');
  return data
    ? { isUASTC: true, isSetKTX2SRGBTransferFunc: false, isPerceptual: false, isNormalMap: slots.includes('normalTexture') }
    : { isUASTC: false, isSetKTX2SRGBTransferFunc: true, isPerceptual: true };
}

let cached;
/** { encodeToKTX2, version, sharp } or null when ktx2-encoder (or sharp, the PNG/JPEG decoder it needs in Node) is not installed */
export async function loadWasmEncoder() {
  if (cached !== undefined) return cached;
  cached = null;
  const req = createRequire(resolve(ROOT, 'package.json'));
  try {
    // the package only exports an ESM entry, so require.resolve cannot find it: import by name, else from the project's node_modules
    let mod; try { mod = await import('ktx2-encoder'); } catch { mod = await import(pathToFileURL(resolve(ROOT, 'node_modules/ktx2-encoder/dist/node/index.js')).href); }
    const version = JSON.parse(readFileSync(resolve(ROOT, 'node_modules/ktx2-encoder/package.json'), 'utf8')).version;
    cached = { encodeToKTX2: mod.encodeToKTX2, version, sharp: req('sharp') };
  } catch {}
  return cached;
}

/**
 * Encodes every PNG / JPEG / WebP texture of the document to KTX2 by its slot, in place; adds KHR_texture_basisu.
 * @returns {Promise<{ count: number, ms: number }>}
 */
export async function encodeTextures(doc, ext, enc) {
  const t0 = Date.now(), textures = doc.getRoot().listTextures();
  // sharp decodes to raw RGBA (the encoder wants pixels in Node)
  const imageDecoder = async buf => { const { data, info } = await enc.sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { data: new Uint8Array(data), width: info.width, height: info.height }; };
  let count = 0;
  // the wasm encoder prints a dozen lines per slice through console.log; the command's own report says what matters
  const log = console.log; console.log = () => {};
  try {
  for (const t of textures) {   // one at a time: the wasm encoder is single threaded and a big texture needs its memory to itself
    if (!/^image\/(png|jpeg|webp)$/.test(t.getMimeType())) continue;
    const label = t.getURI() || t.getName() || 'texture';
    try {
      const out = await enc.encodeToKTX2(new Uint8Array(t.getImage()), { ...optionsForSlots(textureSlots(doc, t)), generateMipmap: true, imageDecoder });
      t.setImage(out).setMimeType('image/ktx2'); count++;
    } catch (e) { throw new Error(`texture ${label}: ${e.message}`); }
  }
  } finally { console.log = log; }
  if (count) doc.createExtension(ext.KHRTextureBasisu).setRequired(true);
  return { count, ms: Date.now() - t0 };
}
