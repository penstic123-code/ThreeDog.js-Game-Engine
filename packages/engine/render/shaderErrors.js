// Shader errors naming the patch and slot.
// Design: docs/plans/done/2026-11-02-look-architecture.md §4g.
// Why: patch code is injected into the middle of three's shader, and the original error gives only "line 812", so an AI cannot tell which patch is wrong. On injection slots.js's mark() adds
// `// threedog:begin patch=x slot=y` / `// threedog:end` before and after each piece; here, going up from the error line number, find the nearest begin marker and report the patch name and slot.
// three has a hook renderer.debug.onShaderError: once set, three no longer prints on its own, so the original error is printed in full here too (nothing from plain three.js is lost).
// if the game set onShaderError itself, do not override it.
const BEGIN = /^\s*\/\/ threedog:begin patch=(\S+) slot=(\S+)/, END = /^\s*\/\/ threedog:end/;
// a GLSL file served by the vite preset's threedog-live plugin (shader hot reload, render/hotGlsl.js): `// threedog:begin file=<path>`
const FILE = /^\s*\/\/ threedog:begin file=(\S+)/;

/**
 * Which patch (and slot) source line `n` (1-based) falls in, or null when it is in the material's own code
 * @internal
 * @param {string[]} lines @param {number} n
 * @returns {{ patch: string | null, slot: string | null, file?: string } | null} file: 'path:line' when the line is in a hot-reloadable GLSL file
 */
function patchAt(lines, n) {
  // markers nest (a file's code inside a patch), so walk down to line n keeping the open blocks
  const open = [];
  for (let i = 0; i < Math.min(n, lines.length) - 1; i++) {
    const l = lines[i];
    if (END.test(l)) { open.pop(); continue; }
    const m = BEGIN.exec(l), f = FILE.exec(l);
    if (m) open.push({ patch: m[1], slot: m[2] }); else if (f) open.push({ file: f[1], first: i + 2 });
  }
  const p = open.findLast(o => o.patch), f = open.findLast(o => o.file);
  if (!p && !f) return null;
  return { patch: p?.patch ?? null, slot: p?.slot ?? null, ...(f && { file: `${f.file}:${n - f.first + 1}` }) };
}

/**
 * Explain one failed shader stage: '[threedog] shader error in patch 'x' (slot y) ...' per error line, or a note that the error is in
 * the material's own code with the list of engine patches present.
 * @internal
 * @param {'vertex' | 'fragment'} stage @param {string} source @param {string} log
 * @returns {string}
 */
function explainShaderError(stage, source, log) {
  const lines = source.split('\n'), patches = [...new Set(lines.map(l => BEGIN.exec(l)?.[1]).filter(Boolean))];
  const out = [];
  for (const row of log.split('\n')) {
    const m = /ERROR:\s*\d+:(\d+):/.exec(row);
    if (!m) continue;
    const n = +m[1], at = patchAt(lines, n), snippet = (lines[n - 1] ?? '').trim();
    const where = at && [at.file && `file ${at.file}`, at.patch && `patch '${at.patch}' (slot ${at.slot})`].filter(Boolean).join(', ');
    out.push(at ? `[threedog] shader error in ${where}, ${stage} shader: ${row.trim()} | ${snippet}`
      : `[threedog] shader error in the material's own ${stage} code (not in a patch; patches in this program: ${patches.join(', ') || 'none'}): ${row.trim()} | ${snippet}`);
  }
  return out.join('\n');
}

/**
 * Hook renderer.debug.onShaderError (when nothing else holds it) so compile errors name the patch and slot.
 * @internal core/Engine.js
 * @param {import('three').WebGLRenderer} renderer
 */
export function nameShaderErrors(renderer) {
  const d = /** @type {any} */ (renderer).debug;
  if (!d || d.onShaderError) return;
  d.onShaderError = (gl, program, vs, fs) => {
    const parts = [];
    for (const [stage, sh] of /** @type {const} */ ([['vertex', vs], ['fragment', fs]])) {
      const log = gl.getShaderInfoLog(sh) || '';
      if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !log.trim()) continue;
      // always append the full original log after the explanation: the explanation picks only `ERROR: n:m:` lines and drops warnings and others; the file header promised "no line of the original error is lost"
      const why = explainShaderError(stage, gl.getShaderSource(sh) || '', log);
      parts.push(why ? `${why}\n[threedog] ${stage} shader log:\n${log.trim()}` : `[threedog] ${stage} shader: ${log.trim()}`);
    }
    const link = gl.getProgramInfoLog(program) || '';
    console.error(parts.join('\n') + (link.trim() ? `\n[threedog] program link: ${link.trim()}` : '') + '\n(raw anchors and slots: render/slots.js)');
  };
}
