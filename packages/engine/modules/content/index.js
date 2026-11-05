// Content loader: game data files into the engine.
// It hands the plain data in content/*.js to the modules (items, pickups, vegetation, NPCs, dialogues, quests, key actions, trigger zones, props).
//   engine.use(content());
//   engine.assets.manifest(yourAssets);                      // models content names (an asset pack; content never holds paths or code)
//   engine.content.load(data, { places: { home: { x, z } } });  // or several packs at once: load([base, dlc, level]) (packs.js)
// Condition/effect vocabulary is in rules.js. Games add condition words (content/rules.js, or content.condition(name, { test }) in code);
// a game's own actions are ops, called from content with { op: ['noun.verb', args] } and tested with { can: [...] }.
// Op names used in content are checked when the game becomes ready (did you mean...).
// Templates (content/templates.js): reusable objects placed from props.js ({ template, x, z }) or engine.content.spawn; see templates.js.
// Props (content/props.js) and pickups (pickups.js) are stored in engine.world (requires world(); openWorld() includes it; see props.js for the stable id
// rule),
// models and collision are built only near the focus; move / remove with engine.world.move / remove, saved with the save. Procedural models of vegetation and
// props go through core/assets/namedModel.js protoOf (name = model name; the same path pickups and vegetation use):
// baked files from npm run bake are read from file, otherwise cached automatically in dev. Models arrive asynchronously: the loading screen of start() waits
// for them (isReady) before the game counts as ready.
// Repeated load: a quest's startOn and a trigger's enter/exit effects do not attach listeners twice (the later load overrides the same name).
// Pickups, props and NPCs are initial world data: the save records only changes and removals, so content.load before or after loading a save gives the same
// result.
// Positions that use level markers belong to the current level: the data carries a zone, and a level change only tears down models (pickups taken and removals
// are remembered); trigger zones are removed on level change.
import { contentExplain } from './explain.js';
import { reportError } from '../../core/base/errors.js';
import { CONDITIONS, EFFECTS } from './rules.js';
import { missingText } from '../../core/base/validate.js';
import { loadContent, BUILTIN_TESTS, BUILTIN_RUNS } from './loader.js';
import { templateOf, spawnTemplate, placeTemplate } from './templates.js';
import { packsOf } from './packs.js';
import { IdCheck } from './ids.js';
import { fieldsOf } from './fields.js';
import { addPlaces, placeOf, offsetFrom, whereOf } from './places.js';
import { testWords, runWords } from './words.js';
import { setMark, marksPart } from './markers.js';
import { codedError } from '../../core/base/errorHints.js';

/** The state the module's files share: loader.js and templates.js fill it on each content.load, st.e is set at install */
function contentState() {
  const st = {
    e: null, places: {},
    pending: new Set(),                               // model promises the module waits for (ready)
    triggers: {}, subs: null, startOn: new Map(), ops: new Set(), kinds: {},
    marks: new Map(),                                 // marker id -> [position, label]: what the marker effect shows (the content save part)
    templates: new Map(), templateViews: new Set(),   // template name -> frozen definition; names whose presenter is registered
    templateSims: new Set(),                          // names whose world.simulate (stages / update) is registered
    templateSrc: new Map(),                           // dev: template name -> 'content/templates.js:12'
    templateFields: new Map(),                        // template name -> parsed state fields (fields.js), for placement checks and content.fields()
    levelPlace: name => !!name && !(name in st.places) && !!st.e.level?.marker(name),
    wait: p => { st.pending.add(p); p.catch(err => reportError(st.e, err, 'content model', { soft: true })).finally(() => st.pending.delete(p)); },
    conds: new Map(Object.entries(CONDITIONS).map(([k, d]) => [k, { ...d, test: BUILTIN_TESTS[k] }])),
    effects: new Map(Object.entries(EFFECTS).map(([k, d]) => [k, { ...d, run: BUILTIN_RUNS[k] }])),
  };
  return st;
}

/** The object behind engine.content. Its methods call each other through api, so a wrapped method (engine.wrap) is the one that runs */
function contentApi(st) {
  const api = {
    /** All vegetation models are ready and the models of nearby world data such as props are built (world.ready) */
    get ready() { return st.pending.size === 0 && (!st.e.world || st.e.world.ready); },
    /** marker markers added by the marker effect: id -> hud marker */
    markers: new Map(),
    /**
     * @internal the marker / clearMarker effects: set (v = position) or clear (v = null) marker id. What is shown is playthrough state, kept in
     * the 'content' save part, so a load shows the save's markers and a new game none of the old ones (review 0.4 modules-a B5)
     */
    _mark(id, v, label) { setMark(st.e, api, st, id, v, label); },
    /**
     * Load content data: one pack (the object of content/index.js) or a list of packs loaded together in order, where an id defined by two packs is an error
     * (packs.js).
     * Models are asset names (engine.assets.manifest / an asset pack), never paths. Places: a pack's own places file, then the places option on top (a place
     * computed at startup: { places: { home } }); a place is a position, plus rot (radians about Y), and a place file's text entry waits for the option.
     * Loading again with a place moved or turned moves what stands there, models and collision too, unless play moved that record (world.add).
     * @example engine.content.load([baseContent, forestDlc], { places: { home: { x: 0, z: 0 } } })
     * @param {any} data
     * @param {{ places?: Record<string, any> }} [opts]
     */
    load(data, { places: given = {} } = {}) {
      const packs = packsOf(data), ids = new IdCheck();   // one IdCheck for the whole call: an id used in two packs' props / pickups is an error too
      addPlaces(st.places, packs, given);
      st.e.ops.allow(() => { for (const p of packs) loadContent(st.e, api, p, st, ids); });   // loading data is setup, not a gameplay action (ops guard)
      ids.done();
      st.checkOps?.();
      return api;
    },
    /** Register a condition word: condition('timeAfter', { ref: 'clock', desc, test: (e, value) => ... }) */
    condition(name, def) { st.conds.set(name, def); return api; },
    /**
     * Whether a condition holds (object = all listed items hold, array = every item holds, function = called directly as fn(e, { actor })).
     * actor: whose bag { has } / { lacks } look in (default: the running op's actor, else engine.actor), so a net peer's dialogue checks the peer's bag.
     * @example engine.content.test({ has: { berry: 3 } }, { actor: 'peer-2' })
     * @param {any} c
     * @param {{ actor?: string }} [opts]
     */
    test(c, { actor = st.e.ops.actor } = {}) { return testWords(st.e, api, st.conds, c, actor); },
    /**
     * Run an effect (object, array or function fn(e, { actor })). actor: whose bag { give } / { take } change (default: the running op's actor, else
     * engine.actor), so a reward lands in the bag of whoever earned it.
     * @param {any} a
     * @param {{ actor?: string }} [opts]
     */
    run(a, { actor = st.e.ops.actor } = {}) { return runWords(st.e, api, st.effects, a, actor); },
    /**
     * The shared definition of a content template (content/templates.js), frozen: instance state lives on the world record, never here.
     * @example engine.content.template('chest').container.capacity   // 6, the same for every chest
     * @param {string} name
     * @returns {Readonly<Record<string, any>>}
     */
    template(name) { return templateOf(st, name); },
    /**
     * Place a new instance of a content template at runtime (a gameplay change: call it inside an op or a fixed step); saved whole.
     * Returns the world record (kind = template name; without fields.id the id is numbered `<template>#<n>`, e.g. 'chest#3').
     * at is a ground position ({ x, z }, [x, y, z] or an object); fields may set id, rot, scale, y (height above ground), items (container start goods)
     * and the template's state fields (stage too, for a template with stages).
     * @example engine.ops.define('chest.build', { run: (e, { x, z }) => e.content.spawn('chest', { x, z }, { items: { stick: 3 } }).id });
     * @param {string} name
     * @param {any} at
     * @param {{ id?: string, rot?: number, scale?: number, y?: number, items?: Record<string, number>, [state: string]: any }} [fields]
     * @returns {import('../world/World.js').WorldRecord}
     */
    spawn(name, at, fields) { return spawnTemplate(st.e, st, name, at, fields); },
    /**
     * @internal A level-model node with the custom property template: an authored instance with id `<level>/<node>` (level module).
     * entry is a props-style entry ({ template, id, x, z, floor, rot, scale, state fields }); origin = { level, node }
     */
    placeNode(entry, zone, origin) { placeTemplate(st.e, api, st, entry, 0, zone, null, origin); },
    /**
     * The fields one content entry may have, in the core/base/params.js format ({ key: { type, optional?, default?, min?, max?, values?, desc? } }):
     * what an editor panel lists and what content-check validates against (one table, rules.js PLACEMENT_FIELDS + the template / kind `fields`).
     * name: a template name (its placement fields plus its state fields; default = the value in state), an engine entry shape
     * ('props', 'props.template', 'props.grid', 'pickups', 'views'), a game kind with fields (content/rules.js kinds), or a world record id
     * (answers for the shape that record came from).
     * @example engine.content.fields('crop').stage   // { type: 'int', optional: true, default: 0, min: 0, max: 4 }
     * @example engine.content.fields('props').rot    // { type: 'number', optional: true, desc: 'facing around the vertical axis, radians' }
     * @param {string} name
     * @returns {Record<string, { type: string, optional?: boolean, default?: any, min?: number, max?: number, values?: any[], desc?: string }>}
     */
    fields(name) { return fieldsOf(st.e, api, st, name); },
    /** @internal dev: where a template is defined ('content/templates.js:12'), null if unknown */
    templateSource(name) { return st.templateSrc.get(name) ?? null; },
    /** Place name -> position { x, z } plus y when the place has a height (level markers, places given with y) and rot when it is turned; null if not found */
    place(name) { return placeOf(st.e, st.places, name); },
    /** @internal a world x, z as the offset content writes from this place (null: no place), the inverse of where: the editor saves a drag through it */
    offset(place, x, z) { return offsetFrom(api, place, x, z); },
    /**
     * Position notation in content { place?, x?, z?, floor?, y? } -> world coordinates { x, z }, plus y when the notation pins a height.
     * floor: reference height for multi-layer ground (second storey, bridge deck, lower dungeon level): it stands on the highest layer not above floor;
     * a level-marker place lends its own height as floor. y: meters above that ground (shelves, floating pickups).
     * Without floor / y / a marker height the result is { x, z } and the thing sits on the top layer.
     * A place with rot turns the offsets x, z with it (the same sense as a model's rotation.y), so what stands there keeps its layout when the place turns.
     * @example engine.content.where({ place: 'tower', x: 1, floor: 6 })   // the tower's second floor, not its roof
     */
    where(p) { return whereOf(st.e, api, p); },
    /** @internal The floor a position notation stands on (its own floor, else its marker's height); undefined = top layer */
    _floorOf(p) { return p.floor ?? (p.place ? api.place(p.place)?.y : undefined); },
    /** @internal The facing of an entry: its own rot on top of its place's; undefined = neither is written, so the record stays without rot */
    _facingOf(p) { const r = p.place ? api.place(p.place)?.rot : undefined; return r === undefined ? p.rot : r + (p.rot ?? 0); },
  };
  return api;
}

/** content may name ops that main.js defines after load: check once everything is set up, and again for loads after that */
function checkOps(e, st) {
  for (const name of st.ops) if (!e.ops.defs.has(name)) throw codedError('unknown-name', `content: ${missingText('op', name, [...e.ops.defs.keys()])} (used in { op } / { can })`);
}

export function content() {
  const st = contentState(), api = contentApi(st);
  return {
    name: 'content', type: 'rules', label: 'Content',
    optional: ['level', 'calendar', 'inventory', 'pickups', 'quests', 'particles', 'hud', 'vegetation', 'dialogue', 'triggers', 'collision', 'world', 'interactions', 'grids', 'rigid'],
    install(engine, ctx) { engine.i18n.add({ 'zh-CN': { 'module.content': '内容' }, en: { 'module.content': 'content' } });
      const e = st.e = engine;
      st.track = ctx.track;   // loader.js subscribes on the first content.load: those listeners belong to the module too
      engine.explainWith(contentExplain);
      e.saves.register('content', marksPart(api, st));
      ctx.track(e.events.on('engine:ready', () => checkOps(e, st)));
      st.checkOps = () => { if (e.ready) checkOps(e, st); };
      return api;
    },
    isReady() { return api.ready; },
    // ?at=<place> / applyState({ at }): this module owns the names, core does the placing with what it gets back. An unknown name stops here: a picture of the
    // spawn point taken for "the pier" would look fine and be wrong
    stateKeys: ['at'],
    applyState(e, { at }) {
      if (at == null) return;
      const p = api.place(at);
      if (!p) throw codedError('content-place', `applyState({ at: '${at}' }): no such place. Places: ${Object.keys(st.places).join(', ') || '(none loaded)'}; a level marker works too`);
      return p;
    },
    describe() {
      return { props: st.e.world ? st.e.world.query({ kind: 'prop' }).length : 0, templates: [...st.templates.keys()], markers: api.markers.size };
    },
  };
}
