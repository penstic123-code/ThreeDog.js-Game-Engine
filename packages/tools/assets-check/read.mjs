// Reads a glb/gltf into a glTF Transform Document for the asset tools (assets check, build report, content-check).
// @gltf-transform/core, /extensions and meshoptimizer come with @gltf-transform/cli (an optional peer of @threedog/tools, see assets.mjs):
// resolved from the project root instead of imported by name.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ROOT } from '../paths.mjs';

let lib;
/** { core, ext, meshopt } or null when @gltf-transform is not installed (callers say how to install it) */
function load() {
  if (lib !== undefined) return lib;
  const req = createRequire(resolve(ROOT, 'package.json'));
  try {
    const meshopt = (() => { try { return req('meshoptimizer'); } catch { return null; } })();
    lib = { core: req('@gltf-transform/core'), ext: req('@gltf-transform/extensions'), meshopt };
  } catch { lib = null; }
  return lib;
}
export const hasReader = () => !!load();
export const NO_READER = 'reading glb needs @gltf-transform/core: run npm i -D @gltf-transform/cli';

/** @returns {Promise<{ doc: any, core: any }>} Document of the file; Meshopt-compressed files (public/optimized) decode through meshoptimizer when installed */
export async function readModel(path) {
  const l = load();
  if (!l) throw new Error(NO_READER);
  const io = new l.core.NodeIO().registerExtensions(l.ext.ALL_EXTENSIONS);
  if (l.meshopt) { await l.meshopt.MeshoptDecoder.ready; io.registerDependencies({ 'meshopt.decoder': l.meshopt.MeshoptDecoder }); }
  return { doc: await io.read(path), core: l.core };
}
