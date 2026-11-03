// Shared by new-game and init: read the flags, copy the template layers, fill the placeholders.
//   templates/game       the base: a blank scene with a camera, empty content files, an empty style/ folder (no gameplay, no genre assumed)
//   templates/openworld  an overlay for --open-world: generated terrain, day/night sky, follow camera, a player (a main.js only)
//   templates/example    an overlay for --example: the sample (hp, hunger, rest op, apples, stash, HUD) on the open world; implies --open-world
// Why blank by default: an open world is one genre among many (a puzzle, a card table, a side-scroller start from nothing), and a default that has
// to be deleted first steers every new game toward the same shape. Overlays are copied FIRST so their files win over the base.
// Placeholders in text files: __NAME__, __GAMEPLAY_NOTE__. The art always starts in the game's own empty style/ folder (the engine has no published styles).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../paths.mjs';
import { parseOptions } from './cli-args.mjs';

const GAMEPLAY = {
  clean: 'This game starts blank (a scene and a camera) and has no gameplay yet; build what DESIGN.md describes. For patterns, read the engine recipes (`node_modules/threedog/docs/recipes/`, index in AI.md); `threedog new-game name --open-world` starts on generated ground with a player, `--example` adds a small sample on top.',
  openWorld: 'This game starts from `--open-world`: generated ground, a day/night sky, a follow camera and a player, no gameplay yet; build what DESIGN.md describes and remove what it does not need.',
  example: 'This game starts from the `--example` sample: hp / hunger, a rest op, apples with ids, a searchable stash and a HUD counter, all in `main.js` and `content/`. Delete what the design does not need.',
};

/** Read flags: --open-world, --example (implies --open-world); the name is the first other argument. Unknown flags are an error (a typo
 *  silently making the wrong game is worse). env = process.env (npm eats flags: npm_config_* fallback) */
export function parseArgs(argv, env = {}) {
  let p;
  try { p = parseOptions(argv, { flags: ['example', 'open-world'], positional: true }); } catch (e) { return { error: e.message }; }
  if (p.rest.length > 1) return { error: `one name or folder only, got ${p.rest.join(' ')}` };
  const example = !!p.opt.example || env.npm_config_example === 'true';
  const openWorld = example || !!p.opt['open-world'] || env.npm_config_open_world === 'true';
  return { name: p.rest[0], example, openWorld };
}

/** Fill the placeholders of one text file */
export function render(text, { name, example, openWorld }) {
  return text.replaceAll('__NAME__', name).replaceAll('__GAMEPLAY_NOTE__', GAMEPLAY[example ? 'example' : openWorld ? 'openWorld' : 'clean']);
}

/** package.json dependencies: --open-world / --example add @threedog/terrain-noise (their main.js imports it; the blank base does not) */
export function applyDeps(deps, { openWorld }) {
  const out = { ...deps };
  if (openWorld) out['@threedog/terrain-noise'] ??= '^0.5.0';
  return out;
}

/** Copy the template layers (overlay first, base after) into dir. Existing files are kept (so the overlay wins and init never overwrites).
 *  skipPackage: leave package.json to the caller. Returns { made, kept }. */
export function copyTemplates(dir, opts, { skipPackage = false } = {}) {
  const layers = [...(opts.example ? ['example'] : []), ...(opts.openWorld ? ['openworld'] : []), 'game'], made = [], kept = [];
  const walk = (from, to, top) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name), dst = join(to, e.name);
      if (e.isDirectory()) { walk(src, dst, false); continue; }
      if (skipPackage && top && e.name === 'package.json') continue;
      if (existsSync(dst)) { kept.push(dst); continue; }
      writeFileSync(dst, render(readFileSync(src, 'utf8'), opts)); made.push(dst);
    }
  };
  for (const l of layers) walk(join(TOOLS, 'templates', l), dir, true);
  return { made, kept };
}
