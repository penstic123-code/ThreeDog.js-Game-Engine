// Shared by new-game and init: read the flags, copy the template layers, fill the placeholders.
//   templates/game       the base: a blank scene with a camera, empty content files, a gray picture/ folder (no gameplay, no genre assumed)
//   templates/openworld  an overlay for --open-world: generated terrain, day/night sky, follow camera, a player (a main.js only)
// Why blank by default: an open world is one genre among many (a puzzle, a card table, a side-scroller start from nothing), and a default that has
// to be deleted first steers every new game toward the same shape. Overlays are copied FIRST so their files win over the base.
// Which renderer: a new game starts on WebGPU, its shaders in TSL; --webgl starts on WebGLRenderer, its shaders in GLSL. It is chosen here, once, because it decides the
// language of the game's own shaders; plain three.js materials and lights work on both. createEngine's own default stays WebGL: the choice is written into each new
// game's main.js. A browser without WebGPU gets createEngine's fallback: 'webgl2', the same game on three's WebGL2 backend, TSL still drawing.
// Placeholders in text files: __NAME__, __GAMEPLAY_NOTE__, __DEFAULT_LAYER__ (rows of AI.md) and the ROUTE words below. The art always starts in the game's own gray picture/ folder (the engine ships no art).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS, ENGINE } from '../paths.mjs';
import { defaultLayer } from './default-layer.mjs';
import { parseOptions } from './cli-args.mjs';

const GAMEPLAY = {
  clean: 'This game starts blank (a scene, a camera, a start screen, autosave, an Esc menu) and has no gameplay yet; build what DESIGN.md describes. For patterns, read the engine recipes (`node_modules/threedog/docs/recipes/`, index in AI.md); `threedog new-game name --open-world` starts on generated ground with a player.',
  openWorld: 'This game starts from `--open-world`: generated ground, a day/night sky, a follow camera, a player, a start screen, autosave and an Esc menu, no gameplay yet; build what DESIGN.md describes and remove what it does not need.',
};

// What differs by renderer inside shared template files. A __TSL_IMPORT__ line with nothing to say goes away whole.
const ROUTE = {
  webgpu: {
    __TSL_IMPORT__: "import 'threedog/tsl';   // first import: this game runs on WebGPU and writes shaders in TSL, recipe 56. A browser without WebGPU runs the same game on three's WebGL2 backend (slower); engine.describe().renderer says which and why",
    __RENDERER__: "renderer: 'webgpu', ",
    __PICTURE_ROUTE__: "This game runs on WebGPU: shaders are TSL on node materials, recipe 56; GLSL (`ShaderMaterial`, `onBeforeCompile`) stops with an error naming it. A browser without WebGPU\nruns the same game on three's WebGL2 backend, slower; `engine.describe().renderer` says which backend draws, why and what it can do.",
    __MATERIAL_IMPORT__: "// Node materials take the same options as the plain ones. A shader here is TSL on a material's fields (colorNode, positionNode, emissiveNode...), recipe 56:\n// import { color, positionWorld, sin } from 'three/tsl'; material.colorNode = color(0x88aa66).mul(sin(positionWorld.y).mul(0.1).add(0.9));\nimport { MeshStandardNodeMaterial } from 'three/webgpu';",
    __STANDARD_MATERIAL__: 'MeshStandardNodeMaterial',
    __OWN_SHADER__: '`new THREE.*Material`, a node material with TSL, recipe 56',
    __OWN_POST__: 'own TSL effect (`engine.post.add({ name, slot, node })`, recipe 56)',
  },
  webgl: {
    __TSL_IMPORT__: '',
    __RENDERER__: '',
    __PICTURE_ROUTE__: 'This game runs on WebGL: shaders are GLSL (`ShaderMaterial`, `onBeforeCompile`).',
    __MATERIAL_IMPORT__: "import { THREE } from 'threedog';",
    __STANDARD_MATERIAL__: 'THREE.MeshStandardMaterial',
    __OWN_SHADER__: '`new THREE.*Material`, `ShaderMaterial`, `onBeforeCompile`',
    __OWN_POST__: 'own three.js passes / shader (`engine.post.add({ name, slot, create })`)',
  },
};

/** Read flags: --open-world, --webgl; the name is the first other argument. Unknown flags are an error (a typo
 *  silently making the wrong game is worse). env = process.env (npm eats flags: npm_config_* fallback) */
export function parseArgs(argv, env = {}) {
  let p;
  try { p = parseOptions(argv, { flags: ['open-world', 'webgl'], positional: true }); } catch (e) { return { error: e.message }; }
  if (p.rest.length > 1) return { error: `one name or folder only, got ${p.rest.join(' ')}` };
  const openWorld = !!p.opt['open-world'] || env.npm_config_open_world === 'true';
  const webgl = !!p.opt.webgl || env.npm_config_webgl === 'true';
  return { name: p.rest[0], openWorld, webgl };
}

/** The "Already here" table: rows of the engine's AI.md (the one task table). Without the engine docs next to the tools: a pointer, not a stale copy */
function defaultLayerTable() {
  const f = join(ENGINE, 'docs', 'AI.md');
  return existsSync(f) ? defaultLayer(readFileSync(f, 'utf8')).table : 'Read `AI.md` in `node_modules/threedog/docs/` (one row per task).';
}

/** Fill the placeholders of one text file */
export function render(text, { name, openWorld, webgl }) {
  const route = ROUTE[webgl ? 'webgl' : 'webgpu'];
  let out = text.replaceAll('__NAME__', name).replaceAll('__GAMEPLAY_NOTE__', GAMEPLAY[openWorld ? 'openWorld' : 'clean']);
  out = out.replace('__DEFAULT_LAYER__', () => defaultLayerTable());
  out = out.replace(/__TSL_IMPORT__\r?\n/g, route.__TSL_IMPORT__ && `${route.__TSL_IMPORT__}\n`);
  for (const [word, value] of Object.entries(route)) out = out.replaceAll(word, value);
  return out;
}

/** package.json dependencies: --open-world adds @threedog/terrain-noise (its main.js imports it; the blank base does not) */
export function applyDeps(deps, { openWorld }) {
  const out = { ...deps };
  if (openWorld) out['@threedog/terrain-noise'] ??= '^0.7.1';
  return out;
}

/** Copy the template layers (overlay first, base after) into dir. Existing files are kept (so the overlay wins and init never overwrites).
 *  skipPackage: leave package.json to the caller. Returns { made, kept }. */
export function copyTemplates(dir, opts, { skipPackage = false } = {}) {
  const layers = [...(opts.openWorld ? ['openworld'] : []), 'game'], made = [], kept = [];
  const walk = (from, to, top) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name), dst = join(to, e.name);
      if (e.isDirectory()) { walk(src, dst, false); continue; }
      if (skipPackage && top && e.name === 'package.json') continue;
      if (existsSync(dst)) { kept.push(dst); continue; }
      const text = render(readFileSync(src, 'utf8'), opts);
      writeFileSync(dst, text); made.push(dst);
      // AGENTS.md is the same rendered text as CLAUDE.md, for tools that do not read CLAUDE.md. Written only beside a CLAUDE.md made now,
      // and never over a file already there (init into a project that has its own AGENTS.md)
      const agents = join(to, 'AGENTS.md');
      if (top && e.name === 'CLAUDE.md' && !existsSync(agents)) { writeFileSync(agents, text); made.push(agents); }
    }
  };
  for (const l of layers) walk(join(TOOLS, 'templates', l), dir, true);
  return { made, kept };
}
