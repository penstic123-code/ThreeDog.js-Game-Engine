// Single source of every path. Rules, generators, the test runner, screenshots, perf and bake all read from here; do not hard-code paths elsewhere.
// Two layouts, picked by project(cwd):
//   monorepo  this repository: packages/engine/ (threedog), packages/tools/ (@threedog/tools), games/<name>/ (one workspace per game)
//   game      a game in its own repo that installed threedog + @threedog/tools from npm: the game folder is the root (plus games/* if it holds several)
// In both layouts the engine folder is found with Node resolution (createRequire(...).resolve('threedog/package.json')), so ENGINE is
// packages/engine in the monorepo (through the workspace link) and node_modules/threedog in a game.
// Convention: names ending in _REL are paths relative to ROOT, separated by / (shown in rules and generated docs); the rest are absolute paths.
import { existsSync, statSync } from 'node:fs';
import { join, relative, dirname, sep, resolve, basename } from 'node:path';
import { TOOLS, readJson, subdirs, project } from './project.mjs';
export { TOOLS, project };

const PROJECT = project();
/** 'monorepo' or 'game' (see project()) */
export const MODE = PROJECT.mode;
export const ROOT = PROJECT.root;
/** Relative to ROOT, separated by / */
export const rel = p => relative(ROOT, p).split(sep).join('/');
/** Path relative to ROOT → absolute path */
export const abs = r => join(ROOT, r);
/** How generated game docs cite an engine file (node_modules/threedog/...) */
export const docRef = PROJECT.docRef;

// ── Engine package ──────────────────────────────────────
export const ENGINE = PROJECT.engineDir;
export const ENGINE_REL = rel(ENGINE);
/** Engine source directories (the hard-rule check, R2/R10/R11 etc. only scan these + index.js) */
export const ENGINE_CODE_DIRS_REL = ['core', 'modules', 'render', 'ui'].map(d => `${ENGINE_REL}/${d}`);
export const CORE_REL = `${ENGINE_REL}/core`;
export const MODULES_REL = `${ENGINE_REL}/modules`;
export const INDEX_JS_REL = `${ENGINE_REL}/index.js`;
export const INDEX_DTS_REL = `${ENGINE_REL}/index.d.ts`;
export const TYPES_REL = `${ENGINE_REL}/types`;
/**
 * Declarations generated from JSDoc in JS source (npm run map generates them, not edited by hand, committed to git); mirrors the engine source directory
 * layout: generated/ui/UI.d.ts ← ui/UI.js
 */
export const TYPES_GEN_REL = `${TYPES_REL}/generated`;
/**
 * Source files already migrated to "JSDoc → generated d.ts" (relative to the repo root). To migrate a file: add a line here → write JSDoc in the source →
 * delete the matching declarations from the hand-written d.ts → npm run map.
 * The path must be inside the engine package (the generated output mirrors its directory layout).
 */
export const MIGRATED_JS_REL = [
  `${ENGINE_REL}/ui/UI.js`, `${ENGINE_REL}/ui/Focus.js`, `${ENGINE_REL}/ui/LoadingScreen.js`,
  `${ENGINE_REL}/render/materials.js`, `${ENGINE_REL}/render/patches.js`, `${ENGINE_REL}/render/PostFX.js`,
  `${ENGINE_REL}/modules/water/Water.js`, `${ENGINE_REL}/modules/sky/Sky.js`, `${ENGINE_REL}/modules/sky/skyModule.js`, `${ENGINE_REL}/modules/weather/Weather.js`, `${ENGINE_REL}/modules/particles/Particles.js`, `${ENGINE_REL}/modules/ambience/Ambience.js`, `${ENGINE_REL}/modules/music/Music.js`, `${ENGINE_REL}/modules/timeline/Timeline.js`, `${ENGINE_REL}/modules/debug/DebugPanel.js`, `${ENGINE_REL}/modules/hlod/index.js`, `${ENGINE_REL}/modules/lights/index.js`, `${ENGINE_REL}/modules/hud/index.js`, `${ENGINE_REL}/modules/flow/index.js`,
  `${ENGINE_REL}/modules/net/Net.js`, `${ENGINE_REL}/modules/net/index.js`, `${ENGINE_REL}/modules/net/transports.js`,
  `${ENGINE_REL}/modules/world/World.js`, `${ENGINE_REL}/modules/world/index.js`, `${ENGINE_REL}/modules/grid/index.js`, `${ENGINE_REL}/modules/grid/Grid.js`, `${ENGINE_REL}/modules/grid/Layer.js`,
  `${ENGINE_REL}/core/Random.js`, `${ENGINE_REL}/core/Commits.js`, `${ENGINE_REL}/core/Threads.js`, `${ENGINE_REL}/core/Ops.js`, `${ENGINE_REL}/core/Jobs.js`, `${ENGINE_REL}/core/Events.js`, `${ENGINE_REL}/core/Stream.js`, `${ENGINE_REL}/core/Batching.js`, `${ENGINE_REL}/core/Rays.js`, `${ENGINE_REL}/core/I18n.js`, `${ENGINE_REL}/core/Audio.js`, `${ENGINE_REL}/core/audioVoice.js`, `${ENGINE_REL}/core/Input.js`, `${ENGINE_REL}/core/Saves.js`, `${ENGINE_REL}/core/session.js`, `${ENGINE_REL}/core/page.js`, `${ENGINE_REL}/core/Budget.js`,
];
/**
 * APIs that may still change: each [file, declared name] must carry @experimental in the JSDoc right above it (R07-H); AI.md "Stability" lists them for readers
 */
export const STABILITY = {
  experimental: [
    [`${ENGINE_REL}/modules/net/index.js`, 'net'], [`${ENGINE_REL}/modules/net/transports.js`, 'fakeNetwork'], [`${ENGINE_REL}/modules/net/transports.js`, 'webSocket'],
    [`${ENGINE_REL}/core/Threads.js`, 'Threads'],
    [`${ENGINE_REL}/modules/grid/index.js`, 'grids'], [`${ENGINE_REL}/modules/grid/index.js`, 'Grids'], [`${ENGINE_REL}/modules/grid/Grid.js`, 'Grid'], [`${ENGINE_REL}/modules/grid/Layer.js`, 'Layer'],
    [`${ENGINE_REL}/types/world.d.ts`, 'edit'],
    [`${ENGINE_REL}/render/PostFX.js`, 'add'], [`${ENGINE_REL}/render/PostFX.js`, 'get'], [`${ENGINE_REL}/render/PostFX.js`, 'enable'], [`${ENGINE_REL}/render/PostFX.js`, 'list'],
    [`${ENGINE_REL}/core/Stream.js`, 'source'], [`${ENGINE_REL}/core/Stream.js`, 'sources'], [`${ENGINE_REL}/core/Stream.js`, 'teleport'], [`${ENGINE_REL}/core/Stream.js`, 'readyCheck'],
    [`${ENGINE_REL}/modules/hlod/index.js`, 'hlod'],
    [`${ENGINE_REL}/core/Ops.js`, 'guard'], [`${ENGINE_REL}/core/Ops.js`, 'allow'],
  ],
};
// ── Style packs ─────────────────────────────────────────
// Style packs are separate, optional packages (the engine ships no art): npm name `@threedog/style-<name>`.
// Monorepo: packages/styles/<name>/ (one workspace each). Game mode: node_modules/@threedog/style-<name>/.
export const STYLE_PKG_PREFIX = '@threedog/style-';
/** Folder that holds the style packs (monorepo: packages/styles; game mode: node_modules/@threedog) */
export const STYLES_REL = MODE === 'monorepo' ? 'packages/styles' : 'node_modules/@threedog';
/** Style pack name from an import specifier ('@threedog/style-lowpoly' or a subpath of it → 'lowpoly'), null if it is not one */
export const styleName = spec => spec.startsWith(STYLE_PKG_PREFIX) ? spec.slice(STYLE_PKG_PREFIX.length).split('/')[0] : null;
/** Absolute folder of a style pack by name (lowpoly → packages/styles/lowpoly or node_modules/@threedog/style-lowpoly) */
export const styleDir = name => join(abs(STYLES_REL), MODE === 'monorepo' ? name : 'style-' + name);
// ── Optional packages that are not style packs ──────────
// Gameplay-side add-ons such as the terrain generator (world shape is not a look, so it may not live in a style pack): npm name
// `@threedog/<name>`, monorepo folder packages/<name>/ (one workspace each). Listed by name so rules scan them like the style packs.
/** Add-on package names (without the @threedog/ scope) */
export const ADDON_PKGS = ['terrain-noise', 'post-effects'];
/** Absolute folder of an add-on package (monorepo: packages/<name>; game mode: node_modules/@threedog/<name>) */
export const addonDir = name => MODE === 'monorepo' ? abs(`packages/${name}`) : join(abs('node_modules/@threedog'), name);
/** Add-on folders scanned as project source (monorepo only: in game mode they sit inside STYLES_REL's node_modules/@threedog already) */
export const ADDONS_REL = MODE === 'monorepo' ? ADDON_PKGS.map(n => `packages/${n}`) : [];
/** Entry file of an optional package import ('@threedog/style-<x>' or an add-on such as '@threedog/terrain-noise'), null for anything else */
export const optionalEntry = spec => {
  if (styleName(spec)) return join(styleDir(styleName(spec)), 'index.js');
  const a = spec.startsWith('@threedog/') ? spec.slice('@threedog/'.length).split('/')[0] : null;
  return a && ADDON_PKGS.includes(a) ? join(addonDir(a), 'index.js') : null;
};
export const EXAMPLES_REL = `${ENGINE_REL}/examples`;
export const ENGINE_TESTS_REL = `${ENGINE_REL}/tests`;
export const DOCS_REL = `${ENGINE_REL}/docs`;
export const API_MD_REL = `${DOCS_REL}/API.md`;
export const API_DIR_REL = `${DOCS_REL}/api`;
export const CODEMAP_REL = `${DOCS_REL}/CODEMAP.md`;
export const RECIPES_REL = `${DOCS_REL}/recipes`;
export const EVENTS_GEN_REL = `${CORE_REL}/events.generated.js`;
export const CORE_DTS_REL = `${TYPES_REL}/core.d.ts`;
export const I18N_CORE_REL = `${CORE_REL}/I18n.js`;
export const CONTENT_RULES_REL = `${MODULES_REL}/content/rules.js`;
/** Content id rules (index ids, missingIds): read by `threedog content ids` */
export const CONTENT_IDS_REL = `${MODULES_REL}/content/ids.js`;
export const BAKED_REL = `${CORE_REL}/Baked.js`;
export const ENGINE_SPECS = abs(`${ENGINE_TESTS_REL}/specs.mjs`);
/** Package name games use to import the engine (the d.ts types hang on this package too) */
export const ENGINE_PKG = 'threedog';

// ── Tools package ───────────────────────────────────────
export const TOOLS_REL = rel(TOOLS);
export const RULES_REL = `${TOOLS_REL}/rules`;

// ── Games ───────────────────────────────────────────────
export const GAMES_REL = 'games';
export const GAMES = abs(GAMES_REL);

/** Folder names no scan descends into (dependencies, build output, caches, assets, screenshots); callers add 'tests' etc. when needed */
export const SKIP_DIRS = ['node_modules', 'dist', '.threedog', 'public', 'shots', '.git'];

/**
 * A game in its own repo (MODE 'game'): which files are the game's own sources. Everything else under the game folder is a dependency and is never
 * checked, typed or mapped as game code. Set in the game's package.json, paths relative to the game folder:
 *   "threedog": { "src": ["main.js", "src", "content"], "exclude": ["notes"] }
 * Defaults: src = the whole folder; always excluded: node_modules (SKIP_DIRS), vendor/, and every local-path dependency (file: / link: specs).
 */
export const GAME_EXCLUDE_DEFAULT = ['vendor'];
function gameScope() {
  const pkg = readJson(join(ROOT, 'package.json')) ?? {}, cfg = pkg.threedog ?? {};
  const local = Object.values({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
    .map(String).filter(v => /^(file|link):/.test(v)).map(v => resolve(ROOT, v.replace(/^(file|link):/, '')));
  return {
    src: (cfg.src ?? ['.']).map(p => resolve(ROOT, p)),
    exclude: [...GAME_EXCLUDE_DEFAULT, ...(cfg.exclude ?? [])].map(p => resolve(ROOT, p)).concat(local),
  };
}
const inside = (p, dir) => p === dir || p.startsWith(dir + sep);
let scope = null;
/** The game's source scope in game mode ({ src, exclude }, absolute paths); null in the monorepo */
export const gameSources = () => MODE === 'game' ? (scope ??= gameScope()) : null;
/**
 * Whether a walk that started at `start` should leave out the absolute path p (a file or folder): only in game mode, only for walks over the game
 * folder (a walk inside the engine package, wherever it is installed or vendored, is never filtered). A folder is kept while it contains or lies under
 * a src entry; a file must lie under one.
 */
export function notGameSource(p, start, isDir) {
  const s = gameSources();
  if (!s || inside(resolve(start), ENGINE) || !inside(resolve(p), ROOT)) return false;
  const a = resolve(p);
  if (s.exclude.some(x => inside(a, x))) return true;
  return !s.src.some(x => inside(a, x) || (isDir && inside(x, a)));
}
/** Source scope scanned by rules, file size etc. (directories relative to the repo root) */
export const SOURCE_DIRS_REL = [...ENGINE_CODE_DIRS_REL, STYLES_REL, ...ADDONS_REL, EXAMPLES_REL, ENGINE_TESTS_REL, TOOLS_REL, GAMES_REL];
/** Game code (examples + games/*): only checked for direct new materials, type checking, key text, etc. */
export const GAME_CODE_DIRS_REL = [EXAMPLES_REL, GAMES_REL];
/** Generated docs and declarations (not edited by hand, exempt from size checks) */
export const GENERATED = [
  new RegExp(`^${DOCS_REL}/API\\.md$`), new RegExp(`^${API_DIR_REL}/`), new RegExp(`^${DOCS_REL}/CODEMAP\\.md$`), /\/GAMEMAP\.md$/,
  new RegExp(`^${TYPES_GEN_REL}/`), new RegExp(`^${ENGINE_REL}/llms\.txt$`),
];

/** Every game folder (with a main.js), absolute paths (see project().gameDirs) */
export const gameDirs = PROJECT.gameDirs;

/**
 * Workspaces that can be bundled and tested on their own, absolute paths: monorepo = the engine package (examples, test pages) + each game; game mode = the
 * game folder(s)
 */
export const workspaces = () => MODE === 'monorepo'
  ? [ENGINE, ...subdirs(GAMES).filter(d => existsSync(join(d, 'package.json')))]
  : gameDirs().filter(d => existsSync(join(d, 'package.json')));

/** The workspace a folder belongs to (nearest package.json, not above ROOT; ROOT itself only in game mode); null if none */
export function workspaceOf(dir) {
  for (let d = resolve(dir); d === ROOT || d.startsWith(ROOT + sep); d = dirname(d)) {
    if ((d !== ROOT || MODE === 'game') && existsSync(join(d, 'package.json'))) return d;
    if (d === ROOT) break;
  }
  return null;
}

/**
 * Find a workspace by name: 'engine', 'my-farm', 'games/my-farm', the package name 'threedog', or an unambiguous part of a name ('farm').
 * null if not found; throws when a partial name matches several workspaces.
 */
export function findWorkspace(name) {
  if (!name) return null;
  const list = workspaces();
  const n = String(name).replace(/\/$/, '');
  const exact = list.find(d => rel(d) === n || basename(d) === n || '@threedog/' + basename(d) === n || (d === ENGINE && (n === 'engine' || n === ENGINE_PKG)));
  if (exact) return exact;
  const part = list.filter(d => basename(d).includes(n));
  if (part.length > 1) throw new Error(`workspace "${n}" is ambiguous, matches: ${part.map(rel).join(', ')}`);
  return part[0] ?? null;
}

/**
 * The workspace a CLI command operates on: `-w name` / `--workspace name` in the arguments wins; otherwise the workspace of the current directory (with npm run
 * xx -w games/a the cwd is that one);
 * otherwise the fallback (the engine package by default). Returns { dir, args }, with the -w arguments removed from args.
 */
export function pickWorkspace(argv, { cwd = process.cwd(), fallback = ENGINE } = {}) {
  const args = [...argv];
  const i = args.findIndex(a => a === '-w' || a === '--workspace');
  if (i >= 0) {
    const name = args[i + 1]; args.splice(i, 2);
    const dir = findWorkspace(name);
    if (!dir) throw new Error(`workspace "${name}" not found. Available: ${workspaces().map(rel).join(', ')}`);
    return { dir, args };
  }
  const here = workspaceOf(cwd);
  return { dir: here && workspaces().includes(here) ? here : fallback, args };
}

/** Whether a file is under a directory (both as paths relative to the repo root) */
export const under = (file, dirRel) => file === dirRel || file.startsWith(dirRel + '/');
/** Whether it is an existing file */
export const isFile = p => existsSync(p) && statSync(p).isFile();
