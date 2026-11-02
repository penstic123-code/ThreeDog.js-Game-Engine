// Approximate shader cost per compiled program, for engine.debug.view('shaderCost') and engine.inspect.perf().
// Read from what three.js already compiled: renderer.properties.get(material).currentProgram is the WebGLProgram three made for that material
// (three's own bookkeeping; WebGLRenderer only). Cost = code lines of the final fragment shader (after three expanded its #include chunks; #if branches
// are not evaluated, so it over-counts) plus SAMPLER_WEIGHT per active sampler. A ranking aid, not a GPU timing: use it to find the heaviest
// materials, then measure with the GPU tools (Spector.js through `threedog capture`).
// Plain three.js equivalent: renderer.info.programs (the list) and gl.getShaderSource / gl.getActiveUniform on program.program.
const SAMPLER_WEIGHT = 25;
const SAMPLERS = new Set([0x8B5E, 0x8B60, 0x8B62, 0x8B5F, 0x8DC1, 0x8DD2, 0x8DCA, 0x8DCC, 0x8DCF, 0x8DD7, 0x8DC4]);   // GL sampler uniform types
const memo = new WeakMap();   // WebGLProgram -> cost (a compiled program never changes)

/** Code lines of a GLSL source: no blank lines, comments or preprocessor lines @param {string} src */
function codeLines(src) {
  let n = 0;
  for (const l of src.split('\n')) { const t = l.trim(); if (t && !t.startsWith('//') && !t.startsWith('#')) n++; }
  return n;
}

/**
 * Cost of one WebGLProgram, or null when it cannot be read (not WebGL, not linked yet)
 * @param {any} renderer @param {any} program a three.js WebGLProgram (renderer.info.programs[i])
 * @returns {{ name: string, fragmentLines: number, vertexLines: number, samplers: number, score: number } | null}
 */
export function programCost(renderer, program) {
  if (!program?.program) return null;
  if (memo.has(program)) return memo.get(program);
  const gl = renderer.getContext?.();
  if (!gl?.getAttachedShaders) return null;
  let fragmentLines = 0, vertexLines = 0, samplers = 0;
  try {
    for (const sh of gl.getAttachedShaders(program.program) || []) {
      const n = codeLines(gl.getShaderSource(sh) || '');
      if (gl.getShaderParameter(sh, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) fragmentLines = n; else vertexLines = n;
    }
    const u = gl.getProgramParameter(program.program, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < u; i++) if (SAMPLERS.has(gl.getActiveUniform(program.program, i)?.type)) samplers++;
  } catch { return null; }
  const r = { name: program.name || program.type || 'program', fragmentLines, vertexLines, samplers, score: fragmentLines + SAMPLER_WEIGHT * samplers };
  memo.set(program, r);
  return r;
}

/** The program three.js compiled for a material, or null @param {any} renderer @param {any} material */
function programOf(renderer, material) {
  try { return renderer.properties?.get(material)?.currentProgram ?? null; } catch { return null; }
}

/** Cost of the program a material uses now (null until it was drawn once) @param {any} renderer @param {any} material */
export const materialCost = (renderer, material) => programCost(renderer, programOf(renderer, material));
