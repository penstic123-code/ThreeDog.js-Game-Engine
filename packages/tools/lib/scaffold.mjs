// Shared by new-game and init: read the flags, copy the template layers, fill the placeholders.
//   templates/game     the clean base: ground, player, follow camera, sky, empty content files, an empty style/ pack (no gameplay)
//   templates/example  an overlay for --example: the old sample (hp, hunger, rest op, apples, stash, HUD), copied FIRST so its files win over the base
// Placeholders in text files: __NAME__, __STYLE_IMPORT__, __STYLE_OPT__, __STYLE_NOTE__, __GAMEPLAY_NOTE__.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../paths.mjs';

/** --style empty (default: the game's own empty style/ folder), or a path (./x, ../x) / a package name of a style pack you have */
const isPath = v => /^\.{1,2}\//.test(v) || v.startsWith('/');
function stylePart(style) {
  if (style === 'empty') return { imp: "import style from './style/index.js';   // the game's own style pack: empty for now (gray placeholders); fill it, recipes 09 and 52", opt: 'style, ',
    note: 'The style pack in style/ is empty: the game has no look yet; fill it (recipes 09, 52) or pass a pack of your own or a published one (`--style <path-or-package>`).' };
  return { imp: `import style from '${style}';   // the style pack you chose: all the art lives there (the engine ships none)`, opt: 'style, ',
    note: `Style pack: \`${style}\`. The empty \`style/\` folder is not used; remove it or fill it to make your own.` };
}
const GAMEPLAY = {
  clean: 'This game has no gameplay yet; build what DESIGN.md describes. For patterns, read the engine recipes (`node_modules/threedog/docs/recipes/`, index in AI.md); `npx threedog new-game name --example` shows a small sample.',
  example: 'This game starts from the `--example` sample: hp / hunger, a rest op, apples with ids, a searchable stash and a HUD counter, all in `main.js` and `content/`. Delete what the design does not need.',
};

/** Read flags: --style <empty|path|package> or --style=x, --example, --blank (alias of the clean default); the name is the first other argument. env = process.env (npm eats flags: npm_config_* fallback) */
export function parseArgs(argv, env = {}) {
  let style = env.npm_config_style && env.npm_config_style !== 'true' ? env.npm_config_style : null;
  const example = argv.includes('--example') || env.npm_config_example === 'true', rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style') style = argv[++i] ?? '';
    else if (a.startsWith('--style=')) style = a.slice(8);
    else if (!a.startsWith('-')) rest.push(a);
  }
  if (style === '') return { error: '--style needs a value: empty (default), a path to a style pack folder, or a package name' };
  return { name: rest[0], example, style: style ?? 'empty' };
}

/** Fill the placeholders of one text file */
export function render(text, { name, style, example }) {
  const s = stylePart(style);
  return text.replaceAll('@threedog/__NAME__', name).replaceAll('__NAME__', name).replaceAll('__STYLE_IMPORT__', s.imp).replaceAll('__STYLE_OPT__', s.opt)
    .replaceAll('__STYLE_NOTE__', s.note).replaceAll('__GAMEPLAY_NOTE__', GAMEPLAY[example ? 'example' : 'clean']);
}

/** package.json dependencies for the style choice: the template lists none; a package-name style is added (any version), empty or a path adds nothing */
export function applyStyleDeps(deps, style) {
  const out = { ...deps };
  if (style !== 'empty' && !isPath(style)) out[style.replace(/^(@[^/]+\/[^/]+|[^/@][^/]*).*$/, '$1')] ??= '*';
  return out;
}

/** Copy the template layers (overlay first, base after) into dir. Existing files are kept (so the overlay wins and init never overwrites).
 *  skipPackage: leave package.json to the caller. With a chosen style the empty style/ folder is not written. Returns { made, kept }. */
export function copyTemplates(dir, opts, { skipPackage = false } = {}) {
  const layers = [...(opts.example ? ['example'] : []), 'game'], made = [], kept = [];
  const walk = (from, to, top) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name), dst = join(to, e.name);
      if (top && e.name === 'style' && opts.style !== 'empty') continue;
      if (e.isDirectory()) { walk(src, dst, false); continue; }
      if (skipPackage && top && e.name === 'package.json') continue;
      if (existsSync(dst)) { kept.push(dst); continue; }
      writeFileSync(dst, render(readFileSync(src, 'utf8'), opts)); made.push(dst);
    }
  };
  for (const l of layers) walk(join(TOOLS, 'templates', l), dir, true);
  return { made, kept };
}
