// threedog how --browse [category] and --card <id>: the layered way to what exists, for when the words to search with are the problem. A few categories, then one short line per
// capability, then a card by stable id. Why cards are built here and not written: a second text about each system would drift. The facts come from the metadata (install, dependencies,
// time, saves, what hand-written code it replaces), the docs (read, example) and how-tasks.mjs (task words, category, the few hand-written "does not fit" lines). Rule R64 proves every
// capability has a category and a card; nothing here proves an AI picks the right one, that has not been measured.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { metadata } from 'threedog/metadata';
import { docEntries, clip, TASKS_TEST } from './how.mjs';
import { MODULES, FACTORIES, GROUPS, RECIPES, CATEGORIES, NOT_FOR } from './how-tasks.mjs';
import { esc } from './lib/text.mjs';

const idsOf = c => c.ids.trim().split(/\s+/);
/** The first category a capability is listed in; a capability may sit in two, an AI browsing either should meet it */
const categoryOf = id => Object.entries(CATEGORIES).find(([, c]) => idsOf(c).includes(id))?.[0];
const names = (call, id) => new RegExp(`\\b${esc(call)}\\(|\\bengine\\.${esc(id)}\\b`);

/** The "go down a layer" column of the CONVENTIONS.md row that names this entry, or the section's own "When it does not fit" */
function notFor(id, re, entries, section) {
  const row = entries.find(e => e.src === 'entry' && re.test(e.title + ' ' + e.use));
  return NOT_FOR[id] ?? row?.nofit ?? section?.nofit;
}
/** A task section that uses it (a test runs those), else the first short recipe section that does */
function exampleOf(re, entries) {
  const sections = entries.filter(e => e.src === 'recipe' && e.blocks?.[0] && re.test(e.blocks[0]));
  return sections.find(e => e.task) ?? sections.find(e => e.blocks[0].split('\n').length <= 20);
}
const verifiedBy = s => !s ? 'no example' : s.task ? `run by the test "${TASKS_TEST}"` : 'type-checked by rule R13, not run';
const example = s => s && { at: s.at, code: s.blocks[0], verified: verifiedBy(s) };

/** The module that gives a required slot, by its call */
const giver = cap => Object.entries(metadata.modules).find(([k, x]) => k === cap || x.provides.includes(cap))?.[1].call;
/** A module's install and requires lines, the same on its own card and on the card of a member it brings. A rig has no call of its own: its cameras install it */
function installOf(m, call = m.call) {
  const calls = call === m.call && m.aliases?.length ? m.aliases.map(a => a.call) : [call];
  return { install: `import { ${calls.join(', ')} } from 'threedog'; engine.use(${calls[0]}(${m.needs.length ? `{ ${m.needs.join(', ')} }` : ''}))`, requires: [...new Set(m.requires.map(giver).filter(c => c && c !== call))].map(c => c + '()').join(', ') || 'none' };
}

function moduleCard(id, m, call, task, entries, docsDir) {
  // three facts, never one guessed from another: the module's name is the code member (engine.<name>), a slot is what replaces: names, and call is what installs it
  const member = call === m.call ? id : Object.keys(metadata.modules).find(k => metadata.modules[k] === m), slots = m.provides.filter(s => s !== member);
  const re = names(call, member), section = exampleOf(re, entries), kinds = Array.isArray(m.handRolled) ? m.handRolled : [];
  const params = Object.keys(m.params ?? {}).slice(0, 4);
  return { id, kind: call === m.call ? 'module' : 'factory', title: m.label ?? id, solves: task, replaces: metadata.hints[kinds[0]]?.seen, notFor: notFor(id, re, entries, section),
    ...installOf(m, call), options: params.join(', '), slots: slots.join(', '),
    optional: m.optional.join(', '), time: `${m.time.hooks.length ? `runs in ${m.time.hooks.join(', ')}; ` : ''}time skip: ${m.time.kind ?? 'none'}${m.time.noSkip ? ` (${m.time.noSkip})` : ''}`,
    saves: m.saves?.length ? `saved with the game as ${m.saves.join(', ')}` : 'no save part of its own',
    use: `engine.${member}`, read: existsSync(join(docsDir, 'api', `${id}.md`)) ? `api/${id}.md` : undefined, example: example(section) };
}
function groupCard(id, task, entries, docsDir) {
  const re = names(id, id), section = exampleOf(re, entries), calls = entries.filter(e => e.src === 'api' && e.title.startsWith(id + '.') && !/^(\(experimental\) )?Optional\b/.test(e.use)).slice(0, 6).map(e => e.title.replace(/\(.*$/, '()'));
  const made = metadata.members[id], owner = made && metadata.modules[made.module], later = made && made.by !== 'install' && (owner.names.includes(made.by) ? `engine.${made.module}.${made.by}()` : `${made.by}()`);
  return { id, kind: 'group', title: `engine.${id}`, solves: task, notFor: notFor(id, re, entries, section), ...(owner ? installOf(owner) : { install: 'in every engine, nothing to install' }),
    create: later ? `engine.${id} is null until ${later} runs` : undefined, use: calls.join(', ') || `engine.${id}`,
    read: existsSync(join(docsDir, 'api', `${id}.md`)) ? `api/${id}.md` : undefined, example: example(section) };
}
function recipeCard(id, task, entries) {
  const own = entries.filter(e => e.src === 'recipe' && e.at.startsWith(`recipes/${id}.md`)), top = own[0], section = own.find(e => e.blocks?.[0]);
  return { id, kind: 'recipe', title: top?.title ?? id, solves: top?.para ? `${task}. ${clip(top.para, 150)}` : task, notFor: NOT_FOR[id], read: `recipes/${id}.md`, example: example(section),
    sections: own.slice(1, 7).map(e => e.name).join('; ') };
}

/** Every capability as a card: [{ id, kind, category, title, solves, ... }], one per task line. Rule R64 reads this very list */
export function capabilityCards(docsDir, meta = metadata) {
  const entries = docEntries(docsDir), out = [];
  for (const [id, m] of Object.entries(meta.modules)) {
    out.push(moduleCard(id, m, m.call, MODULES[id], entries, docsDir));
    for (const a of m.aliases ?? []) out.push(moduleCard(a.call, m, a.call, FACTORIES[a.call], entries, docsDir));
  }
  for (const [g, task] of Object.entries(GROUPS)) out.push(groupCard(g, task, entries, docsDir));
  for (const f of readdirSync(join(docsDir, 'recipes')).filter(x => x.endsWith('.md')).sort()) out.push(recipeCard(f.slice(0, -3), RECIPES[f.slice(0, -3)], entries));
  return out.map(c => ({ ...c, category: categoryOf(c.id) }));
}

/** The first screen: one line per category */
export function categoryLines(docsDir) {
  const cards = capabilityCards(docsDir);
  return Object.entries(CATEGORIES).map(([id, c]) => {
    const listed = idsOf(c);
    return `${id}: ${c.title} (${listed.filter(x => cards.some(k => k.id === x)).length}), e.g. ${listed.slice(0, 3).join(', ')}`;
  });
}
/** One category: "id: task words", the systems first, then the recipes. null for an unknown category */
export function categoryCards(docsDir, category) {
  if (!CATEGORIES[category]) return null;
  const ids = idsOf(CATEGORIES[category]), cards = capabilityCards(docsDir).filter(c => ids.includes(c.id));
  return [...cards.filter(c => c.kind !== 'recipe'), ...cards.filter(c => c.kind === 'recipe')];
}
export const cardLine = c => `${c.id}: ${clip(c.solves ?? '', 70)}`;

/** A card as printed; every line a card has no fact for is left out */
export function cardText(c, { full = false, installed = [] } = {}) {
  const row = (k, v) => v ? [`${k}: ${v}`] : [];
  return [`${c.id} (${c.kind}, ${c.category}): ${c.title}`, ...row('Solves', clip(c.solves ?? '', 210)), ...row('Replaces', c.replaces), ...row('Does not fit', clip(c.notFor ?? '', 210)), ...row('Install', c.install), ...row('Create', c.create), ...row('Options', c.options), ...installed,
    ...row('Slot', c.slots), ...row('Requires', c.requires), ...row('Optional', c.optional), ...row('Time', c.time), ...row('Saves', c.saves), ...row('Use', c.use), ...row('Sections', c.sections), ...row('Read', c.read),
    ...(c.example ? [`Example: ${c.example.at} (${c.example.verified})`, ...(full ? c.example.code.split('\n').map(l => '  ' + l) : [])] : ['Example: none yet']), ...(full || !c.example ? [] : ['The example itself: ask again with --full.'])].join('\n');
}
