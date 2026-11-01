// threedog init [name]: turn the current folder into a game outside this repository (after `npm install threedog @threedog/tools ...`).
// Flags as new-game: --example (the sample overlay), --style empty|<path-or-package>. Copies the new-game template (templates/game) without overwriting anything that exists, merges package.json (type, scripts, dependencies),
// and writes .mcp.json so Claude Code opened in this folder finds the threedog MCP server by itself (plain node: no npx start-up, no `cmd /c`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { TOOLS } from './paths.mjs';
import { parseArgs, applyStyleDeps, copyTemplates } from './lib/scaffold.mjs';

const dir = process.cwd();
const parsed = parseArgs(process.argv.slice(2), process.env);
if (parsed.error) { console.error(parsed.error + '\nUsage: npx threedog init [name] [--example] [--style empty|<path-or-package>]'); process.exit(1); }
const name = (parsed.name ?? basename(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
const opts = { ...parsed, name };
const made = [], kept = [];

// The template layers (clean base; --example overlays the sample); a file that already exists is kept; package.json is merged below
const r = copyTemplates(dir, opts, { skipPackage: true });
made.push(...r.made); kept.push(...r.kept);

// package.json: keep what the folder has, add only what is missing (the style choice decides the style dependencies)
const tpl = JSON.parse(readFileSync(join(TOOLS, 'templates', 'game', 'package.json'), 'utf8'));
const pkgPath = join(dir, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : { name, version: '0.1.0', private: true };
pkg.type ??= 'module';
pkg.scripts = { ...tpl.scripts, ...pkg.scripts };
pkg.dependencies = { ...applyStyleDeps(tpl.dependencies, opts.style), ...pkg.dependencies };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const mcp = join(dir, '.mcp.json');
if (!existsSync(mcp)) {
  writeFileSync(mcp, JSON.stringify({ mcpServers: { threedog: { command: 'node', args: ['node_modules/@threedog/tools/bin/threedog.mjs', 'mcp'] } } }, null, 2) + '\n');
  made.push(mcp);
} else kept.push(mcp);

const short = p => p.slice(dir.length + 1).replaceAll('\\', '/');
console.log(`✓ threedog init: ${made.length} files written, package.json merged${kept.length ? `, ${kept.length} existing files kept (${kept.slice(0, 5).map(short).join(', ')}${kept.length > 5 ? ', …' : ''})` : ''}`);
console.log('Next: npm install  →  npm run dev  →  open Claude Code in this folder (it asks once to trust the threedog MCP server in .mcp.json)');
