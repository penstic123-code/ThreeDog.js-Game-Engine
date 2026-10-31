// R26 render entry points: shader code and post-processing each have one way in.
// Detection: a line that assigns `.onBeforeCompile =` or `.customProgramCacheKey =`, or constructs `new EffectComposer(`, is an error in
// engine code (core, modules, render, ui) and style packs, except in render/patches.js and render/PostFX.js (the two places that own them).
// In game code (examples, games/*) it is a warning that says why: three.js stays open to game developers, but such a line overrides the
// engine's patches or post slots, so the fix names what to use instead. Why: a direct onBeforeCompile assignment silently replaces every patch on that material (wind,
// clouds, season, a pack's own patch) and the shadow that follows them; a second EffectComposer renders a chain the engine does not
// know about (MSAA, slots, resize, dispose).
// Also a warning in engine code: `<something>material.clone()` on a line without copyPatches (a clone starts without the
// source's patches, so a pack material's wind or custom patch would silently drop).
// Limits: line-based on code with strings and comments stripped, so `m['onBeforeCompile'] = f` or a composer built through an alias
// is not seen; tests and tools are not scanned (tests call onBeforeCompile on purpose).
import { walk, lines, codeOnly, P, E, isEngineCode } from './_lib.mjs';

const OWNERS = new Set([E('render/patches.js'), E('render/PostFX.js')]);
const CLONE = /[mM]aterials?\w*(\[\w+\])?\.clone\(\)/;
const CHECKS = [
  { re: /\.onBeforeCompile\s*=(?!=)/, what: 'assigns onBeforeCompile directly', why: "it replaces every engine patch on that material (wind, clouds, season, a pack's own) and their shadow pass",
    fix: "use applyEffects(material, { patches: [{ name, glsl: { vertex|fragment: { anchor: code } } }] }) (render/patches.js); it stacks with the material's own onBeforeCompile and the engine's effects" },
  { re: /\.customProgramCacheKey\s*=(?!=)/, what: 'assigns customProgramCacheKey directly', why: 'it replaces the program key the engine patches build, so differently patched materials can share one program', fix: 'give the patch a cacheKey instead: applyEffects(material, { patches: [{ name, cacheKey, glsl }] })' },
  { re: /\bnew\s+EffectComposer\s*\(/, what: 'builds its own EffectComposer', why: 'the engine renders through the engine.post slots, so a second composer runs a chain it does not know (MSAA, resize, settings toggles, dispose)', fix: "add a named effect instead: engine.post.add({ name, slot: 'scene' | 'hdr' | 'ldr' | 'final', create: ctx => pass }) (recipe 09 §2c)" },
];

export default {
  id: 'R26', title: 'Shader code goes through applyEffects, post-processing through engine.post',
  run() {
    const out = [];
    const files = [P.INDEX_JS_REL, ...[...P.ENGINE_CODE_DIRS_REL, P.STYLES_REL, ...P.GAME_CODE_DIRS_REL].flatMap(d => walk(d, ['.js', '.mjs']))];
    for (const f of files) {
      if (OWNERS.has(f)) continue;
      const game = P.GAME_CODE_DIRS_REL.some(d => P.under(f, d));   // game code: allowed with a warning (three.js is not hidden from games)
      lines(f).forEach((raw, i) => {
        const code = codeOnly(raw);
        for (const c of CHECKS) if (c.re.test(code)) out.push(game ? { level: 'warn', file: f, line: i + 1, msg: `${c.what} (${c.why}): ${raw.trim().slice(0, 80)}`, fix: c.fix }
          : { level: 'error', file: f, line: i + 1, msg: `${c.what}: ${raw.trim().slice(0, 80)}`, fix: c.fix });
        if (isEngineCode(f) && CLONE.test(code) && !/copyPatches\(/.test(code)) out.push({ level: 'warn', file: f, line: i + 1, msg: `clones a material without its shader patches: ${raw.trim().slice(0, 80)}`,
          fix: 'wrap it: copyPatches(src, src.clone()) (render/patches.js), so wind, clouds and pack patches stay on the clone' });
      });
    }
    return out;
  },
};
