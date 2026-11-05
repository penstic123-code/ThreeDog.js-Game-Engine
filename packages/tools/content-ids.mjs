// threedog content ids [-w game | <game folder>] [--write]: give every stateful content entry that relies on its index id (pickups, template instances with state /
// container / interact / body) the id it has today, written into the content file, so inserting an entry above it can no longer shift it.
// Why the id it has today ('chest:3') and not a nicer one: old saves name it that way, so writing it changes nothing for a player. A readable id
// comes after, as a rename in content/renames.js ({ 'chest:3': 'chest-home' }), which moves the saved state along.
// Dry run by default (prints each change as -/+ lines); --write applies. Which entries and which ids: missingIds in the engine's content/ids.js,
// the same list the dev warning at load uses. Where they are in the file: the content source walker (vite/vite-threedog-content-src.js).
// Only object literals written directly in the exported array are edited (an entry built by a loop or after a spread is listed as "edit by hand").
//
// threedog content set|add|remove: one entry (content-write.mjs). threedog content stamp|capture and set --source: arrangements (content-stamp.mjs).
// set --source <arrangement> <part> field=value is an explicit batch edit of every copy: copies are plain entries and never follow on their own.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseAst } from 'vite';
import { abs, rel, command, CONTENT_IDS_REL } from './paths.mjs';
import { loadGame, partOf } from './content-check/load.mjs';
import { exportedLiteral } from './vite/vite-threedog-content-src.js';
import { writeAtomic } from './lib/atomic.mjs';
import { lit } from './content-write.mjs';

const { missingIds } = await import(pathToFileURL(abs(CONTENT_IDS_REL)).href);

/**
 * The edits for one game folder: { files: [{ path, before, after, lines: ['- …', '+ …'] }], manual: ['content/props.js[4] -> chest:4 (built by code)'] }
 * @param {string} dir  game folder
 */
export async function planIds(dir) {
  const { data, parts } = await loadGame(dir);
  const byFile = new Map();
  for (const m of missingIds(data)) {   // m.index is in the joined kind; a folder kind (content/props/*.js) maps it to the file and its own index
    const at = partOf(parts, m.file, m.index);
    if (!at) continue;
    if (!byFile.has(at.path)) byFile.set(at.path, []);
    byFile.get(at.path).push({ ...m, index: at.index });
  }
  const out = { files: [], manual: [] };
  for (const [path, list] of byFile) {
    const code = readFileSync(path, 'utf8'), node = exportedLiteral(parseAst(code));
    const edits = [];
    for (const m of list) {
      const el = node?.type === 'ArrayExpression' ? node.elements[m.index] : null;
      const spread = node?.elements?.slice(0, m.index + 1).some(x => x?.type === 'SpreadElement');
      if (!el || el.type !== 'ObjectExpression' || spread) { out.manual.push(`${rel(path)}[${m.index}] -> id: '${m.id}' (not a literal in the exported array: edit by hand)`); continue; }
      const id = lit(m.id), next = code[el.start + 1];
      // `{ template: … }` -> `{ id: '…', template: … }`; `{}` -> `{ id: '…' }`
      edits.push({ at: el.start + 1, text: el.properties.length ? ` id: ${id},${/\s/.test(next) ? '' : ' '}` : ` id: ${id} ` });
    }
    if (!edits.length) continue;
    let after = code;
    for (const e of [...edits].sort((a, b) => b.at - a.at)) after = after.slice(0, e.at) + e.text + after.slice(e.at);
    const a = code.split('\n'), b = after.split('\n'), lines = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) lines.push(`${rel(path)}:${i + 1}`, `- ${a[i].trim()}`, `+ ${b[i].trim()}`);
    out.files.push({ path, before: code, after, lines });
  }
  return out;
}

async function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === 'stamp') return (await import('./content-stamp.mjs')).stampMain(rest);
  if (sub === 'capture') return (await import('./content-stamp.mjs')).captureMain(rest);
  if (sub === 'set' && rest.some(a => a === '--source' || a.startsWith('--source='))) return (await import('./content-stamp.mjs')).sourceMain(rest);
  if (sub === 'set' || sub === 'add' || sub === 'remove') return (await import('./content-write.mjs')).main(sub, rest);
  if (sub !== 'ids') { console.log('Usage: threedog content ids [-w game] [--write]   (dry run by default; --write applies) · threedog content set|add|remove|stamp|capture … (each alone prints its usage)'); return 1; }
  let dir, folders, opt;
  // an optional game folder by path (the engine's examples are not workspaces)
  try { ({ dir, rest: folders, opt } = command(rest, { positional: true, flags: ['write'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  if (folders.length > 1) { console.log(`✗ one game folder only, got ${folders.join(' ')}`); return 1; }
  if (folders[0]) dir = resolve(folders[0]);
  const write = !!opt.write;
  const plan = await planIds(dir);
  const n = plan.files.reduce((s, f) => s + f.lines.length / 3, 0);
  for (const f of plan.files) console.log(f.lines.join('\n'));
  for (const m of plan.manual) console.log('! ' + m);
  if (!n && !plan.manual.length) { console.log(`✓ ${rel(dir)}: every stateful content entry has a written id`); return 0; }
  if (write) for (const f of plan.files) writeAtomic(f.path, f.after);
  console.log(write ? `✓ wrote ${n} id(s) into ${plan.files.length} file(s). Rename one later through content/renames.js: { 'old': 'new' }`
    : `${n} id(s) to write (dry run). Run again with --write to apply`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
