// R26 render entry points: shader code and post-processing each have one way in.
// Detection: a line that assigns `.onBeforeCompile =` or `.customProgramCacheKey =`, or constructs `new EffectComposer(`, is an error in
// engine code (core, modules, render, ui) and styles, except in render/patches.js and render/PostFX.js (the two places that own them).
// In game code (examples, games/*) plain three.js is fine: onBeforeCompile / customProgramCacheKey are not flagged at all, since a material the
// engine patched keeps its patches when the game assigns them later (patches.js chains the game's function first, user decision 5, 2026-11-02);
// a game EffectComposer warns as a choice, naming look.post as one option. Why engine code still may not assign them: engine code goes through
// patchMaterial so patches have names, cache keys and composition checks; a second EffectComposer renders a chain the engine does not
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
    fix: "use applyEffects(material, { patches: [{ name, glsl: { vertex|fragment: { anchor: code } } }] }) (render/patches.js); it stacks with the material's own onBeforeCompile and the engine's effects", engineOnly: true },
  { re: /\.customProgramCacheKey\s*=(?!=)/, what: 'assigns customProgramCacheKey directly', why: 'it replaces the program key the engine patches build, so differently patched materials can share one program', fix: 'give the patch a cacheKey instead: applyEffects(material, { patches: [{ name, cacheKey, glsl }] })', engineOnly: true },
  { re: /\bnew\s+EffectComposer\s*\(/, what: 'builds its own EffectComposer', why: 'the engine renders through the engine.post slots, so a second composer runs a chain it does not know (MSAA, resize, settings toggles, dispose)', fix: "add a named effect instead: engine.look.post.replace([...effects]) with { name, slot: 'scene' | 'hdr' | 'ldr' | 'final', create: ctx => pass } (recipe 09 §2c)",
    gameWhy: 'a second composer is fine for render-to-texture inside engine.onRender; for the main frame the engine already renders through engine.post (MSAA, resize, settings toggles, dispose)',
    gameFix: "one option: put your pass in the engine chain, engine.look.post.add({ name, slot, create: ctx => pass }) (recipes/54-three-idioms.md); a separate composer for your own render target inside engine.onRender is fine", always: true },
];

export default {
  id: 'R26', title: 'Shader code goes through applyEffects, post-processing through engine.post',
  run() {
    const out = [];
    const files = [P.INDEX_JS_REL, ...[...P.ENGINE_CODE_DIRS_REL, P.STYLES_REL, ...P.ADDONS_REL, ...P.GAME_CODE_DIRS_REL].flatMap(d => walk(d, ['.js', '.mjs']))];
    for (const f of files) {
      if (OWNERS.has(f)) continue;
      const game = P.GAME_CODE_DIRS_REL.some(d => P.under(f, d));   // game code: plain three.js is allowed (onBeforeCompile chains, see the header)
      const L = lines(f);
      L.forEach((raw, i) => {
        const code = codeOnly(raw);
        for (const c of CHECKS) if (c.re.test(code) && (!game || c.always) && !(game && c.engineOnly)) out.push(game ? { level: 'warn', file: f, line: i + 1, msg: `${c.what} (${c.gameWhy ?? c.why}): ${raw.trim().slice(0, 80)}`, fix: c.gameFix ?? c.fix }
          : { level: 'error', file: f, line: i + 1, msg: `${c.what}: ${raw.trim().slice(0, 80)}`, fix: c.fix });
        if (isEngineCode(f) && CLONE.test(code) && !/copyPatches\(/.test(code)) out.push({ level: 'warn', file: f, line: i + 1, msg: `clones a material without its shader patches: ${raw.trim().slice(0, 80)}`,
          fix: 'wrap it: copyPatches(src, src.clone()) (render/patches.js), so wind, clouds and pack patches stay on the clone' });
      });
    }
    return out;
  },
};
