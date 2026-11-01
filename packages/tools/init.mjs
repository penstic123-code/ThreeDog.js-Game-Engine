// threedog init [name]: turn the current folder into a game outside this repository (after `npm install threedog @threedog/tools ...`).
// Copies the new-game template (templates/game) without overwriting anything that exists, merges package.json (type, scripts, dependencies),
// and writes .mcp.json so Claude Code opened in this folder finds the threedog MCP server by itself (plain node: no npx start-up, no `cmd /c`).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { TOOLS } from './paths.mjs';

const dir = process.cwd();
const name = (process.argv.slice(2).find(a => !a.startsWith('-')) ?? basename(dir)).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
const made = [], kept = [];

/** Copy recursively; a file that already exists is kept as it is */
function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, e.name), dst = join(to, e.name);
    if (e.isDirectory()) { copy(src, dst); continue; }
    if (e.name === 'package.json' && to === dir) continue;   // merged below
    if (existsSync(dst)) { kept.push(dst); continue; }
    writeFileSync(dst, readFileSync(src, 'utf8').replaceAll('@threedog/__NAME__', name).replaceAll('__NAME__', name));
    made.push(dst);
  }
}
copy(join(TOOLS, 'templates', 'game'), dir);

// package.json: keep what the folder has, add only what is missing
const tpl = JSON.parse(readFileSync(join(TOOLS, 'templates', 'game', 'package.json'), 'utf8'));
const pkgPath = join(dir, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : { name, version: '0.1.0', private: true };
pkg.type ??= 'module';
pkg.scripts = { ...tpl.scripts, ...pkg.scripts };
pkg.dependencies = { ...tpl.dependencies, ...pkg.dependencies };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const mcp = join(dir, '.mcp.json');
if (!existsSync(mcp)) {
  writeFileSync(mcp, JSON.stringify({ mcpServers: { threedog: { command: 'node', args: ['node_modules/@threedog/tools/bin/threedog.mjs', 'mcp'] } } }, null, 2) + '\n');
  made.push(mcp);
} else kept.push(mcp);

const short = p => p.slice(dir.length + 1).replaceAll('\\', '/');
console.log(`✓ threedog init: ${made.length} files written, package.json merged${kept.length ? `, ${kept.length} existing files kept (${kept.slice(0, 5).map(short).join(', ')}${kept.length > 5 ? ', …' : ''})` : ''}`);
console.log('Next: npm install  →  npm run dev  →  open Claude Code in this folder (it asks once to trust the threedog MCP server in .mcp.json)');
