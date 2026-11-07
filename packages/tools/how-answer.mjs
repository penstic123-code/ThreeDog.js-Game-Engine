// threedog how "<effect or task>" [-w game] [--full], --browse [category], --card <id>: one answer to a task, the same from the command line and the MCP tool `how`.
// It leads with one recommended route, then says whether that route is installed in this project, which dependency is missing, a minimal example, and
// what to do when it does not fit. --full adds the other routes with their paragraphs. A recommendation is a first read, never the only allowed way.
// Sources: the docs search (how.mjs), the game's renderer and code, the connected page's catalog when one is attached, and the asset library.
import { readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { metadata } from 'threedog/metadata';
import { command } from './paths.mjs';
import { pageAttached } from './devinfo.mjs';
import { esc, gameCodeFiles } from './lib/text.mjs';
import { installedCalls, read, noComments } from './gamemap/text.mjs';
import { search, format, tryNext, libraryHits, metadataHits, gameRenderer, queryTokens, DOCS, docPath } from './how.mjs';
import { capabilityCards, categoryLines, categoryCards, cardLine, cardText } from './how-browse.mjs';

/** Lines of a borrowed example printed by default; a task example from recipe 66 prints whole, it is written short */
const EXAMPLE_LINES = 10;
// a letter outside plain English: the docs are English, so those words can match nothing, and a long list of closest hits would read like an answer
const NOT_ENGLISH = /(?![a-zA-Z])\p{L}/u;
const startHere = () => `Search words are English: try English task words, threedog how --browse, or ${docPath('AI.md')}.`;
const MODULES = Object.entries(metadata.modules);
const callsOf = m => [m.call, ...(m.aliases ?? []).map(a => a.call)];
// engine.particles?.emit is an optional use: the route works without that module. An API page's route line opens with the name alone (`api/quests.md · quests.start(id)`):
// only there does the bare form count, because in example code `water.update()` can be any local variable
const nameRe = names => { const n = names.map(esc).join('|'); return new RegExp(`\\b(?:engine|e)\\.(?:${n})\\b(?!\\?)|(?:^|· )(?:${n})\\.\\w`); };

/** Engine modules a route's text names, by the function that installs them or by engine.<name>: [module id] (one per install call: weather() builds two modules) */
export function routeModules(text) {
  const seen = new Set(), out = [];
  for (const [id, m] of MODULES) {
    if (seen.has(m.call)) continue;
    if (new RegExp(`\\b(?:${callsOf(m).map(esc).join('|')})\\(`).test(text) || nameRe([id, ...m.provides]).test(text)) { seen.add(m.call); out.push(id); }
  }
  return out;
}

/** npm packages an example imports, other than the engine and three.js that every game has */
const examplePackages = code => [...new Set([...code.matchAll(/^\s*import\s[^'"]*['"]([^'".][^'"]*)['"]/gm)].map(m => m[1])
  .map(s => s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]))].filter(p => p !== 'three' && p !== 'threedog');

/** What the project at dir has: { calls: module functions its code installs, packages, renderer }, or null when dir is no game */
function projectFacts(dir) {
  const renderer = gameRenderer(dir);
  if (!renderer) return null;
  const code = gameCodeFiles(dir).filter(f => !f.includes(`${sep}content${sep}`)).map(read).join('\n'), pkg = join(dir, 'package.json');
  const json = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')) : {};
  // a plugin file installs by what it exports (plugins/ in recipe 40): `export default stamina()`
  const plugged = [...noComments(code).matchAll(/export default (\w+)\(/g)].map(m => m[1]);
  return { renderer, calls: new Set([...installedCalls(code), ...plugged]), packages: new Set(Object.keys({ ...json.dependencies, ...json.devDependencies })) };
}

/** The connected page's catalog: { ids: every installed id, hits: lines for this game's own modules a typed word names }; null with no page. Any failure means "no page" */
async function liveFacts(dir, q) {
  if (!await pageAttached(dir)) return null;
  try {
    const { execute } = await import('./threedog/dispatch.mjs'), word = queryTokens(q).main.find(w => /^[a-z]/.test(w));
    const within = p => Promise.race([p, new Promise(done => setTimeout(done, 4000, null))]);
    const all = await within(execute(dir, 'catalog', [])), found = word ? await within(execute(dir, 'catalog', ['--find', word])) : null;
    return { ids: all?.ok && Array.isArray(all.data) ? new Set(all.data.map(m => m.id)) : null,
      hits: (found?.data?.rows ?? []).filter(m => !metadata.modules[m.id]).slice(0, 3).map(m => `${m.id} (${m.kind}${m.ops?.length ? ', ops: ' + m.ops.slice(0, 4).map(o => o.name ?? o).join(', ') : ''}) → threedog catalog ${m.id}`) };
  } catch { return null; }
}

/** Is a module in the project? The page's own list wins: it also sees what code builds at run time */
const has = (id, project, live) => live?.ids ? live.ids.has(id) : callsOf(metadata.modules[id]).some(c => project.calls.has(c));

/** The route against the project: { installed, absent, missing: [{ call, for }], packages, known } */
export function installState(ids, code, project, live = null) {
  const known = !!(project || live?.ids), on = id => known && has(id, project, live);
  const call = id => metadata.modules[id].call + '()';
  const missing = [];
  for (const id of ids) for (const cap of metadata.modules[id].requires) {
    const givers = MODULES.filter(([k, m]) => k === cap || m.provides.includes(cap)).map(([k]) => k);   // a name no module gives comes with the core
    if (!givers.length || givers.some(on) || givers.some(g => ids.includes(g))) continue;
    if (!missing.some(x => x.call === call(givers[0]))) missing.push({ call: call(givers[0]), for: call(id) });
  }
  return { known, installed: ids.filter(on).map(call), absent: ids.filter(id => !on(id)).map(call), missing,
    packages: examplePackages(code).filter(p => !project?.packages.has(p)) };
}

/** The Installed line and, when the project is known, the Missing line */
function installLines(s) {
  if (!s.installed.length && !s.absent.length && !s.packages.length) return ['Installed: nothing to install, this is core engine or plain three.js.'];
  if (!s.known) return [`Installed: unknown, no game here (use -w <game>). The route takes ${[...s.absent, ...s.missing.map(m => m.call), ...s.packages].join(', ')}.`];
  const out = [s.absent.length ? `Installed: ${s.installed.join(', ') || 'none of it'}. Not installed: ${s.absent.join(', ')}; add to engine.use(...) in main.js.` : `Installed: yes (${s.installed.join(', ') || 'no module needed'}).`];
  const lack = [...s.missing.map(m => `${m.call} (${m.for} requires it)`), ...s.packages.map(p => `npm package ${p}`)];
  out.push(lack.length ? `Missing dependency: ${lack.join(', ')}.` : 'Missing dependency: none.');
  return out;
}

const fileOf = at => (at ?? '').replace(/[#:].*$/, '');
/** May a route with no code of its own show this hit's? Only when it is the same thing: the same page, or a block using a module the route names. An example of another system under this route would read as how to do this one */
const sameRoute = (route, h) => !!route.at && fileOf(h.at) === fileOf(route.at) || routeModules(`${route.line} ${route.para}`).some(id => routeModules(h.blocks[0]).includes(id));

/** The example as printed. A task section prints whole (the game code, then the check to run); any other block is the section's first, cut short unless full */
export function exampleLines(route, hits, full) {
  if (route.plain) return { lines: [], code: [] };
  const from = route.blocks?.length ? route : hits.find(h => h.blocks?.length && !h.plain && sameRoute(route, h));
  if (!from) return { lines: [`Example: none in the docs for this route; read ${route.at || 'the row above'}.`], code: [] };
  const code = from.task ? from.blocks : from.blocks.slice(0, 1), indent = t => t.split('\n').map(l => '  ' + l);
  const cut = t => { const L = t.split('\n'); return full || from.task || L.length <= EXAMPLE_LINES ? t : [...L.slice(0, EXAMPLE_LINES), `… (${L.length - EXAMPLE_LINES} more lines)`].join('\n'); };
  const head = from.skeleton ? `Add to your game, reuse what is there (a test runs it, ${from.at}):` : from.task ? `Example (complete; a test runs it, ${from.at}):` : `Example (a piece; its setup is in ${from.at}):`;
  return { code, lines: [head, ...code.flatMap((t, i) => [...(from.task && i === 1 ? ['Check it (threedog js --file <this block>):'] : []), ...indent(cut(t))])] };
}

/** The next route: what the section says itself, else the first hit in another file */
function nextRoute(route, hits) {
  if (route.nofit) return route.nofit;
  return hits.find(h => h !== route && fileOf(h.at) !== fileOf(route.at))?.line ?? `plain three.js and your own code: nothing here forbids them (${docPath('THREE.md')}).`;
}

/** The layered way in, for when the words are the problem: no category gives the first screen, a category its capabilities */
export function browse(category) {
  if (!category) { const lines = categoryLines(DOCS); return { ok: true, text: [...lines, 'Next: threedog how --browse <category>, --card <id>, or how "<task words>".'].join('\n'), data: { categories: lines } }; }
  const cards = categoryCards(DOCS, category);
  if (!cards) return { ok: false, text: `No category "${category}". threedog how --browse lists them.`, data: null };
  return { ok: true, text: [...cards.map(cardLine), 'Next: threedog how --card <id>.'].join('\n'), data: { category, ids: cards.map(c => c.id) } };
}

/** One capability by its stable id, with what this project already has */
export async function card(dir, id, { full = false } = {}) {
  const c = capabilityCards(DOCS).find(x => x.id === id);
  if (!c) return { ok: false, text: `No capability "${id}". threedog how --browse lists them, how "<task words>" searches.`, data: null };
  const project = projectFacts(dir), module = (c.kind === 'module' ? metadata.modules[c.id] && c.id : MODULES.find(([, m]) => m.aliases?.some(a => a.call === c.id))?.[0]);
  return { ok: true, text: cardText(c, { full, installed: module && project ? installLines(installState([module], '', project)) : [] }), data: c };
}

/**
 * The one answer behind the CLI and MCP `how`: { ok, text, data }.
 * @param {string} dir game folder  @param {string} q the task  @param {{ full?: boolean }} [o]
 */
export async function answer(dir, q, { full = false } = {}) {
  if (!q) return browse();
  const foreign = NOT_ENGLISH.test(q);
  if (foreign && !queryTokens(q).main.length) return { ok: true, text: startHere(), data: { query: q, recommended: null, routes: [] } };
  const hits = search(DOCS, q, 5, { renderer: gameRenderer(dir) }), modules = metadataHits(q), live = await liveFacts(dir, q);
  // the user's library, read last: a missing or broken library is no reason to fail a docs search
  let lib = [];
  try { const L = await import('./lib.mjs'); lib = libraryHits(L.entries(L.libraryDir()), q); } catch { /* no library */ }
  const extra = [...(live?.hits ?? []).map(l => `in this game · ${l}`), ...lib];
  if (!hits.length && !modules.length && !extra.length) return { ok: true, text: `No match for "${q}". ${startHere()}`, data: { query: q, recommended: null, routes: [] } };
  const tail = [...modules, ...extra];
  if (hits.weak || !hits.length && !modules.length) {   // nothing to stand behind: the closest hits, said to be that
    const weak = (foreign ? startHere() + '\n' : '') + (hits.weak ? `No good match for "${q}": the closest hits below cover less than a third of it. ${tryNext(hits)}\n\n` : '');
    return { ok: true, text: weak + [...hits.map(format), ...tail.map((l, i) => `${hits.length + i + 1}. ${l}`)].join('\n'), data: { query: q, weak: !!hits.weak, recommended: null, routes: [...hits.map(h => h.line), ...tail] } };
  }
  // a game that runs needs the lines to add, not a whole new file; the first three hits only, further down it is a different task
  const project = projectFacts(dir), route = (project && hits.slice(0, 3).find(h => h.skeleton)) || (hits[0] ?? { line: modules[0], at: '', para: '', blocks: [] });
  const example = exampleLines(route, hits, full), code = example.code.join('\n');
  const ids = route.plain ? [] : routeModules(route.task ? code : [route.line, route.para, code].join('\n'));
  const state = installState(ids, code, project, live), next = nextRoute(route, hits), others = hits.filter(h => h !== route), more = others.length + tail.length;
  const text = [...(foreign ? [startHere()] : []), `Recommended (a good first route, not the only allowed one): ${route.line}`, ...(route.at ? [`  read: ${route.at}`] : []), ...(full && route.para ? [`  ${route.para}`] : []),
    ...installLines(state), ...example.lines, `When it does not fit: ${next}`, ...(full ? [] : extra.slice(0, 1).map(l => `Also: ${l}`)),
    ...(!more ? [] : full ? ['Other routes:', ...others.map(format), ...tail.map((l, i) => `${others.length + i + 1}. ${l}`)] : [`Other routes: ${more} more, ask again with --full.`])].join('\n');
  return { ok: true, text, data: { query: q, recommended: { line: route.line, at: route.at }, install: state, example: example.code, next, routes: [...others.map(h => h.line), ...tail] } };
}

/** CLI body */
export async function main(argv) {
  let dir, rest, opt;
  try { ({ dir, rest, opt } = command(argv, { positional: true, flags: ['full', 'browse', 'card'] })); } catch (e) { console.log('✗ ' + e.message); return 1; }
  const words = rest.join(' ').trim(), r = opt.browse ? browse(words) : opt.card ? await card(dir, words, { full: !!opt.full }) : await answer(dir, words, { full: !!opt.full });
  console.log(r.text);
  return r.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await main(process.argv.slice(2)));
