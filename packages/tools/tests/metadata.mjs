// The metadata cannot be bypassed: every tool reads the one generated file, and none keeps or re-derives its own copy. Why a test as well as `metadata --check`:
// the check only says the file is fresh; a new hand list beside it would stay green there. Real files, real engine, in Node.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { metadata, sectionHomes, sectionDocs } from 'threedog/metadata';
import { ENGINE, TOOLS, ROOT } from '../paths.mjs';
import { catalogCommand } from '../threedog/catalog.mjs';
import { metadataHits } from '../how.mjs';
import { walk } from '../lib/text.mjs';
import { problems as skipProblems } from '../rules/R57-skip-kind.mjs';
import { typeTools, typeGaps } from '../rules/R06-options-sync.mjs';

export const name = 'metadata: one generated source, no tool keeps its own list; catalog, how, editor and loader answer from it';
const read = f => readFileSync(f, 'utf8');

export async function run({ check }) {
  // freshness, by the generator itself
  const gen = spawnSync(process.execPath, [join(TOOLS, 'metadata.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  check('the generated file matches the code', gen.status === 0, gen.stdout.slice(0, 200));

  // the facts come from the definitions: a section's home is its owner's factory, and every section has one
  check('every section has a home', Object.keys(metadata.sections).every(s => sectionHomes[s]));
  check('the home names the owner and what it needs', sectionHomes.pickups === 'pickups() after world()' && sectionHomes.quests === 'quests()', JSON.stringify(sectionHomes));
  check('contracts carry their api', metadata.contracts.inventory.api.includes('add'), JSON.stringify(metadata.contracts.inventory).slice(0, 120));
  check('params carry the page sentence', !!metadata.modules.rigid.params && Object.values(metadata.modules.rigid.params).every(p => p.desc));
  check('a field table carries the panel words', metadata.fields.props.rot.label === 'Facing' && metadata.fields.props.static.rare === true);
  check('live sections are declared by their owners', metadata.sections.props.live && metadata.sections.pickups.live && !metadata.sections.quests.live);

  // no parallel copy comes back: api page parsing lives in the generator alone, the loader and the editor name no list
  const tools = walk(TOOLS, { exts: /\.m?js$/, skip: ['tests', 'templates', 'apidoc'], unscoped: true }).filter(f => !/[\\/](metadata|apidoc)\.mjs$/.test(f));
  check('only the generator reads the api page sections', !tools.some(f => /Methods and properties|\^- Options/.test(read(f))), tools.filter(f => /Methods and properties|\^- Options/.test(read(f))).join(', '));
  check('the content rules keep no section table', !/\bhomes:|SECTION_HOMES|CONTENT_FILES/.test(read(join(ENGINE, 'modules/content/rules.js'))));
  check('every section says what it holds, in its owner', Object.keys(sectionDocs).join() === Object.keys(metadata.sections).join() && Object.values(sectionDocs).every(Boolean));
  const { kindProblems } = await import(pathToFileURL(join(ENGINE, 'modules/content/rules.js')).href);
  check('a game kind may not take a section name', kindProblems({ kinds: { actions: {} } }).length === 1 && kindProblems({ kinds: { startItems: {} } }).length === 1);
  const codemap = read(join(TOOLS, 'codemap.mjs'));
  check('the code map reads modules and actions from here, not from source text', codemap.includes("from 'threedog/metadata'") && !/name: '\(|input\\\.action/.test(codemap));
  check('a module with no key of its own is found by what it declares', ['interact', 'inventory', 'quests', 'photo'].every(a => metadata.actions.some(x => x.action === a && !x.optional))
    && metadata.actions.find(a => a.action === 'cancel')?.hasKey === true);
  check('thin factories carry their definition', metadata.modules.cameraRig.aliases.some(a => a.call === 'followCamera'));

  // the hand-written types cannot fall behind: an option or contract name metadata lists and the d.ts lacks is an error (rule R6 part F)
  const T = typeTools(), hud = { call: 'hud', file: metadata.modules.hud.file };
  const gaps = typeGaps(T, { modules: { hud: { ...hud, params: { noSuchOption: {} } } }, contracts: { collision: { api: ['noSuchCall', 'addBox'], file: 'x' } } });
  check('an option or api missing from the types is reported', gaps.length === 2 && gaps[0].msg.includes('noSuchOption') && gaps[1].msg.includes('noSuchCall') && !gaps[1].msg.includes('addBox'), JSON.stringify(gaps));
  check('every factory with options is matched, thin ones through their own name', !typeGaps(T, metadata).length, JSON.stringify(typeGaps(T, metadata)).slice(0, 300));
  check('a contract name marked @internal stays out of the types', metadata.contracts.collision.internal.includes('resolve') && !metadata.contracts.collision.internal.includes('addBox'));
  const editor = read(join(TOOLS, 'editor/design.js'));
  check('the editor keeps no field or section list', !/\bLABELS\b|\bRARE\b|\bLIVE\b/.test(editor) && editor.includes("from 'threedog/metadata'"));

  // one way to ask why: the tools go through engine.explain, and no second command or stale spelling stays
  const page = read(join(TOOLS, 'threedog/pageFns.mjs')), table = read(join(TOOLS, 'threedog/command-table.mjs'));
  check('no command beside explain answers about one id', !/\bthing: \(a, e\)/.test(page) && !/^  thing: '/m.test(table) && !/\.explain\(\)/.test(page));
  check('explain names only keys it answers', !/explain picture/.test(table) && /explain value/.test(table));

  // one public route per job: rigid is one holder of collider3d, not a second door to it; module state is asked through explain
  const pub = read(join(ROOT, 'docs/api-surface.txt'));
  check('names that had two routes keep one', !/\| rigid\.(addSolid|overlap|sweep) \||\| assets\.lease \||\| moduleStates \||module APIs \| compositeGround\.parts/.test(pub) && /collider3d\.sweep/.test(pub));

  // an upgrade error says what to do: what a 0.9 game hits names the fix, and the page covers each one
  const { hintFor } = await import(pathToFileURL(join(ENGINE, 'core/base/errorHints.js')).href), guide = read(join(ENGINE, 'docs/MIGRATING-1.0.md'));
  check('a removed call answers with its fix', hintFor('e.preventDefault is not a function')?.id === 'fall-prevent' && hintFor('t.explain is not a function')?.id === 'thing-explain');
  check('the upgrade page covers every error', ['shared-taken', 'shared-conflict', 'container', 'module-needs', 'character-option', 'preventDefault', 'level.load', 'save-busy', "explain({ value })"].every(w => guide.includes(w)));

  // the readers answer from it
  const r = catalogCommand({ data: { id: 'rigid', kind: 'module', params: { gravity: { type: 'any' } }, ops: [], saves: [], queries: { describe: null, extra: [], api: ['step', 'internalThing'] } }, ids: [], ops: [] }, 'rigid', {}, ROOT);
  check('catalog takes the option sentence from the metadata', r.data.params.gravity.desc === metadata.modules.rigid.params.gravity.desc, r.text.slice(0, 200));
  check('catalog keeps internals off the api list', !r.data.queries.api.includes('internalThing'));
  check('how finds a module by name with no page', metadataHits('quests').some(l => l.includes('quests()')), metadataHits('quests').join('|'));
  check('how finds a module by its option', metadataHits('fallbackFloor').some(l => l.includes('rigid()')), metadataHits('fallbackFloor').join('|'));

  // skip kinds: every module answers, a missing or hookless kind is refused, a bad word stops engine.use, catalog prints it
  check('every module declares a skip kind', !skipProblems(metadata.modules).length, JSON.stringify(skipProblems(metadata.modules)).slice(0, 200));
  check('a module with no kind is reported', skipProblems({ a: { file: 'a.js', time: { hooks: [] } } }).length === 1);
  check('approx without a skip hook is reported', skipProblems({ a: { file: 'a.js', time: { kind: 'approx', hooks: ['fixed'] } } }).length === 1);
  const { checkType } = await import(pathToFileURL(join(ENGINE, 'core/engine/moduleTypes.js')).href);
  let refused = ''; try { checkType({ name: 'a', skipKind: 'fast' }); } catch (e) { refused = e.message; }
  check('engine.use refuses an unknown kind', refused.includes('skipKind'), refused);
  const w = catalogCommand({ data: { id: 'weather', kind: 'module', time: { hooks: ['skip'], step: 'fixed', skip: true, kind: metadata.modules.weather.time.kind }, optional: [], ops: [], saves: [], queries: { describe: null, extra: [], api: [] } }, ids: [], ops: [] }, 'weather', {}, ROOT);
  check('catalog prints the kind', w.text.includes('skip kind step'), w.text.slice(0, 200));
}
