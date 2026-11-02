// Shader hot reload in dev: a GLSL file imported with `?raw` (import frag from './water.frag?raw') is edited -> the materials using its text recompile,
// the page does not reload. The vite preset's threedog-live plugin (packages/tools/vite/vite-threedog-live.js) serves such a file wrapped in
// `// threedog:begin file=<path>` ... `// threedog:end` markers and, when it changes, calls engine.debug.reloadGlsl(oldText, newText, file).
// Where the text is found: ShaderMaterial / RawShaderMaterial vertexShader and fragmentShader, and shader patch code (applyEffects patches).
// Text a game copies into its own onBeforeCompile closure cannot be found: then nothing matches and the plugin reloads the page instead.
// A compile error in the new text names the file and line (render/shaderErrors.js reads the same markers).
// Plain Vite + three.js equivalent: import.meta.hot.accept('./water.frag?raw', m => { mat.fragmentShader = m.default; mat.needsUpdate = true; }).
import { replacePatchCode } from './patches.js';

/**
 * @param {any} e the engine @param {string} old the file text before (as imported, markers included) @param {string} neu the new text @param {string} [file]
 * @returns {{ file: string | null, materials: number, names: string[] }}
 */
export function reloadGlsl(e, old, neu, file) {
  const mats = new Set();
  e.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m) mats.add(m.userData?._dbgOf ?? m); });
  const changed = new Set(replacePatchCode([...mats], old, neu));
  for (const m of mats) {
    let hit = false;
    for (const k of ['vertexShader', 'fragmentShader']) if (typeof m[k] === 'string' && m[k].includes(old)) { m[k] = m[k].replaceAll(old, neu); hit = true; }
    if (hit) { m.needsUpdate = true; changed.add(m); }
  }
  return { file: file ?? null, materials: changed.size, names: [...changed].map(m => m.name || m.type) };
}
