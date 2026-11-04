// threedog init [folder]: turn a folder into a game outside this repository (after `npm install threedog @threedog/tools ...`). The folder is the
// argument (created when missing; the game is named after it) or, without one, the current folder.
// Flags as new-game: --open-world (generated ground, sky, follow camera, player), --webgl (WebGL and GLSL shaders instead of WebGPU and TSL). Copies the new-game template (templates/game) without overwriting anything that exists, merges package.json (type, scripts, dependencies),
// and writes .mcp.json so Claude Code opened in this folder finds the threedog MCP server by itself (plain node: no npx start-up, no `cmd /c`).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, resolve, relative, sep } from 'node:path';
import { TOOLS } from './paths.mjs';
import { parseArgs, applyDeps, copyTemplates } from './lib/scaffold.mjs';

const USAGE = 'Usage: threedog init [folder] [--open-world] [--webgl]   (folder: where the game goes, default the current folder)';
const parsed = parseArgs(process.argv.slice(2), process.env);
if (parsed.error) { console.error(parsed.error + '\n' + USAGE); process.exit(1); }
// Why the argument is a path: it used to be only a name, so `threedog init .demo/town-farm` wrote 18 files into the repo root and merged the root package.json
const dir = resolve(parsed.name ?? '.');
// A package.json with "workspaces" is a repository root, not a game: the game's files and scripts would be mixed into the repo
const pkgPath = join(dir, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : null;
if (pkg?.workspaces) { console.error(`✗ ${dir} is a repository root (its package.json has "workspaces"), not a game folder. Name the game's own folder: threedog init games/my-game\n${USAGE}`); process.exit(1); }
mkdirSync(dir, { recursive: true });
const name = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
const opts = { ...parsed, name };
const made = [], kept = [];

// The template layers (blank base; --open-world overlays it); a file that already exists is kept; package.json is merged below
const r = copyTemplates(dir, opts, { skipPackage: true });
made.push(...r.made); kept.push(...r.kept);

// package.json: keep what the folder has, add only what is missing (the open-world choice adds its dependency)
const tpl = JSON.parse(readFileSync(join(TOOLS, 'templates', 'game', 'package.json'), 'utf8'));
const out = pkg ?? { name, version: '0.1.0', private: true };
out.type ??= 'module';
out.scripts = { ...tpl.scripts, ...out.scripts };
out.dependencies = { ...applyDeps(tpl.dependencies, opts), ...out.dependencies };
writeFileSync(pkgPath, JSON.stringify(out, null, 2) + '\n');

const mcp = join(dir, '.mcp.json');
if (!existsSync(mcp)) {
  // The tools running this command, when they are installed at or above the game (npm workspaces hoist them to the repo root's node_modules);
  // otherwise the game's own node_modules (npx from a cache: the game installs its own copy next)
  const nmParent = resolve(TOOLS, '..', '..', '..');
  const bin = TOOLS.split(sep).includes('node_modules') && (dir === nmParent || dir.startsWith(nmParent + sep))
    ? relative(dir, join(TOOLS, 'bin', 'threedog.mjs')).replaceAll('\\', '/') : 'node_modules/@threedog/tools/bin/threedog.mjs';
  writeFileSync(mcp, JSON.stringify({ mcpServers: { threedog: { command: 'node', args: [bin, 'mcp'] } } }, null, 2) + '\n');
  made.push(mcp);
} else kept.push(mcp);

const short = p => p.slice(dir.length + 1).replaceAll('\\', '/');
const where = relative(process.cwd(), dir).replaceAll('\\', '/');
console.log(`✓ threedog init${where ? ' ' + where : ''}: ${made.length} files written, package.json ${pkg ? 'merged' : 'created'}${kept.length ? `, ${kept.length} existing files kept (${kept.slice(0, 5).map(short).join(', ')}${kept.length > 5 ? ', …' : ''})` : ''}`);
console.log(`Next: ${where ? `cd ${where}  →  ` : ''}npm install  →  npm run dev  →  open Claude Code in this folder (it asks once to trust the threedog MCP server in .mcp.json)`);
