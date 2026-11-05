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
// props go through core/namedModel.js protoOf (name = model name; the same path pickups and vegetation use):
// baked files from npm run bake are read from file, otherwise cached automatically in dev. Models arrive asynchronously: the loading screen of start() waits
// for them (isReady) before the game counts as ready.
// Repeated load: a quest's startOn and a trigger's enter/exit effects do not attach listeners twice (the later load overrides the same name).
// Pickups, props and NPCs are initial world data: the save records only changes and removals, so content.load before or after loading a save gives the same
// result.
// Positions that use level markers belong to the current level: the data carries a zone, and a level change only tears down models (pickups taken and removals
// are remembered); trigger zones are removed on level change.
import { contentExplain } from './explain.js';
import { warnMissing, missingText } from '../../core/validate.js';
import { reportError } from '../../core/errors.js';
import { parseClock } from '../../core/dayTime.js';
import { CONDITIONS, EFFECTS, list } from './rules.js';
import { loadContent, BUILTIN_TESTS, BUILTIN_RUNS } from './loader.js';
import { templateOf, spawnTemplate, placeTemplate } from './templates.js';
import { packsOf } from './packs.js';
import { placeY } from '../../core/ground.js';
import { IdCheck } from './ids.js';
import { PLACEMENT_FIELDS } from './rules.js';
import { placementShape, fieldsShape } from './fields.js';
import { schemaInfo } from '../../core/params.js';
import { codedError } from '../../core/errorHints.js';

export function content() {
  let e = null, places = {};
  // load state (shared across repeated load calls): see loader.js
  const pending = new Set();
  const st = {
    triggers: {}, subs: null, startOn: new Map(), ops: new Set(), kinds: {},
    marks: new Map(),                                 // marker id -> [position, label]: what the marker effect shows (the content save part)
    templates: new Map(), templateViews: new Set(),   // template name -> frozen definition; names whose presenter is registered
    templateSims: new Set(),                          // names whose world.simulate (stages / update) is registered
    templateSrc: new Map(),                           // dev: template name -> 'content/templates.js:12'
    templateFields: new Map(),                        // template name -> parsed state fields (fields.js), for placement checks and content.fields()
    levelPlace: name => !!name && !(name in places) && !!e.level?.marker(name),
    wait: p => { pending.add(p); p.catch(err => reportError(e, err, 'content model', { soft: true })).finally(() => pending.delete(p)); },
  };
  const conds = new Map(Object.entries(CONDITIONS).map(([k, d]) => [k, { ...d, test: BUILTIN_TESTS[k] }]));
  const effects = new Map(Object.entries(EFFECTS).map(([k, d]) => [k, { ...d, run: BUILTIN_RUNS[k] }]));
  // convert content notation to runtime values by ref (clock time -> fraction, place -> { x, z })
  const norm = (ref, v) => ref === 'clock' ? parseClock(v, e.calendar?.hoursPerDay ?? 24) : ref === 'position' ? api.where(typeof v === 'string' ? { place: v } : v) : v;

  const api = {
    /** All vegetation models are ready and the models of nearby world data such as props are built (world.ready) */
    get ready() { return pending.size === 0 && (!e.world || e.world.ready); },
    /** marker markers added by the marker effect: id -> hud marker */
    markers: new Map(),
    /**
     * @internal the marker / clearMarker effects: set (v = position) or clear (v = null) marker id. What is shown is playthrough state, kept in
     * the 'content' save part, so a load shows the save's markers and a new game none of the old ones (review 0.4 modules-a B5)
     */
    _mark(id, v, label) {
      api.markers.get(id)?.remove(); api.markers.delete(id); st.marks.delete(id);
      if (!v) return;
      st.marks.set(id, [v, label ?? null]);
      const m = e.hud?.marker(v, { label });
      if (m) api.markers.set(id, m);
    },
    /**
     * Load content data: one pack (the object of content/index.js) or a list of packs loaded together in order, where an id defined by two packs is an error
     * (packs.js).
     * Models are asset names (engine.assets.manifest / an asset pack), never paths. places: place name -> position, plus rot (radians about Y).
     * Loading again with a place moved or turned moves what stands there, models and collision too, unless play moved that record (world.add).
     * @example engine.content.load([baseContent, forestDlc], { places: { home: { x: 0, z: 0 } } })
     * @param {any} data
     * @param {{ places?: Record<string, any> }} [opts]
     */
    load(data, { places: pl = {} } = {}) {
      for (const [name, p] of Object.entries(pl)) if (p?.rot !== undefined && !Number.isFinite(p.rot)) throw codedError('content-place', `Place "${name}": rot must be a number of radians about Y, got ${JSON.stringify(p.rot)}`);
      Object.assign(places, pl);
      const packs = packsOf(data), ids = new IdCheck();   // one IdCheck for the whole call: an id used in two packs' props / pickups is an error too
      e.ops.allow(() => { for (const p of packs) loadContent(e, api, p, st, ids); });   // loading data is setup, not a gameplay action (ops guard)
      ids.done();
      st.checkOps?.();
      return api;
    },
    /** Register a condition word: condition('timeAfter', { ref: 'clock', desc, test: (e, value) => ... }) */
    condition(name, def) { conds.set(name, def); return api; },
    /**
     * Whether a condition holds (object = all listed items hold, array = every item holds, function = called directly as fn(e, { actor })).
     * actor: whose bag { has } / { lacks } look in (default: the running op's actor, else engine.actor), so a net peer's dialogue checks the peer's bag.
     * @example engine.content.test({ has: { berry: 3 } }, { actor: 'peer-2' })
     * @param {any} c
     * @param {{ actor?: string }} [opts]
     */
    test(c, { actor = e.ops.actor } = {}) {
      if (!c) return true;
      const ctx = { actor };
      if (typeof c === 'function') return !!c(e, ctx);
      return list(c).every(x => Object.entries(x).every(([k, v]) => {
        const d = conds.get(k);
        if (!d) { warnMissing('condition', k, [...conds.keys()]); return false; }
        return !!d.test(e, norm(d.ref, v), v, ctx);
      }));
    },
    /**
     * Run an effect (object, array or function fn(e, { actor })). actor: whose bag { give } / { take } change (default: the running op's actor, else
     * engine.actor), so a reward lands in the bag of whoever earned it.
     * @param {any} a
     * @param {{ actor?: string }} [opts]
     */
    run(a, { actor = e.ops.actor } = {}) {
      if (!a) return;
      const ctx = { actor };
      if (typeof a === 'function') return a(e, ctx);
      for (const x of list(a)) for (const [k, v] of Object.entries(x)) {
        const d = effects.get(k);
        if (!d) { warnMissing('effect', k, [...effects.keys()]); continue; }
        d.run(e, norm(d.ref, v), v, ctx);
      }
    },
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
    spawn(name, at, fields) { return spawnTemplate(e, st, name, at, fields); },
    /**
     * @internal A level-model node with the custom property template: an authored instance with id `<level>/<node>` (level module).
     * entry is a props-style entry ({ template, id, x, z, floor, rot, scale, state fields }); origin = { level, node }
     */
    placeNode(entry, zone, origin) { placeTemplate(e, api, st, entry, 0, zone, null, origin); },
    /**
     * The fields one content entry may have, in the core/params.js format ({ key: { type, optional?, default?, min?, max?, values?, desc? } }):
     * what an editor panel lists and what content-check validates against (one table, rules.js PLACEMENT_FIELDS + the template / kind `fields`).
     * name: a template name (its placement fields plus its state fields; default = the value in state), an engine entry shape
     * ('props', 'props.template', 'props.grid', 'pickups', 'views'), a game kind with fields (content/rules.js kinds), or a world record id
     * (answers for the shape that record came from).
     * @example engine.content.fields('crop').stage   // { type: 'int', optional: true, default: 0, min: 0, max: 4 }
     * @example engine.content.fields('props').rot    // { type: 'number', optional: true, desc: 'facing around the vertical axis, radians' }
     * @param {string} name
     * @returns {Record<string, { type: string, optional?: boolean, default?: any, min?: number, max?: number, values?: any[], desc?: string }>}
     */
    fields(name) {
      if (st.templates.has(name)) {
        const state = st.templates.get(name).state ?? {}, own = schemaInfo(st.templateFields.get(name));
        for (const k in own) own[k].default = structuredClone(state[k]);   // the default is the state value: written once, in state
        return { ...schemaInfo(placementShape('props.template')), ...own };
      }
      if (PLACEMENT_FIELDS[name]) return schemaInfo(placementShape(name));
      const kind = st.kinds[name];
      if (kind?.fields) {
        const { shape, problems } = fieldsShape(`kind '${name}'`, kind.fields);
        if (problems.length) throw codedError('content-misuse', problems.join('; '));
        return schemaInfo(shape);
      }
      const rec = e.world?.get(name);
      if (rec) return api.fields(rec.kind === 'prop' ? 'props' : rec.kind === 'pickup' ? 'pickups' : rec.kind);
      const known = [...st.templates.keys(), ...Object.keys(PLACEMENT_FIELDS), ...Object.keys(st.kinds).filter(k => st.kinds[k]?.fields)];
      throw codedError('unknown-name', `content.fields: ${missingText('field table', name, known)} (a template name, ${Object.keys(PLACEMENT_FIELDS).join(' / ')}, a game kind with fields, or a world record id)`);
    },
    /** @internal dev: where a template is defined ('content/templates.js:12'), null if unknown */
    templateSource(name) { return st.templateSrc.get(name) ?? null; },
    /** Place name -> position { x, z } plus y when the place has a height (level markers, places given with y) and rot when it is turned; null if not found */
    place(name) {
      const p = places[name] ?? e.level?.marker(name)?.position;
      return p ? { x: p.x, z: p.z, ...(p.y !== undefined && { y: p.y }), ...(p.rot !== undefined && { rot: p.rot }) } : null;
    },
    /**
     * Position notation in content { place?, x?, z?, floor?, y? } -> world coordinates { x, z }, plus y when the notation pins a height.
     * floor: reference height for multi-layer ground (second storey, bridge deck, lower dungeon level): it stands on the highest layer not above floor;
     * a level-marker place lends its own height as floor. y: meters above that ground (shelves, floating pickups).
     * Without floor / y / a marker height the result is { x, z } and the thing sits on the top layer.
     * A place with rot turns the offsets x, z with it (the same sense as a model's rotation.y), so what stands there keeps its layout when the place turns.
     * @example engine.content.where({ place: 'tower', x: 1, floor: 6 })   // the tower's second floor, not its roof
     */
    where(p) {
      const base = p.place ? api.place(p.place) : null;
      if (p.place && !base) throw codedError('content-place', `Place "${p.place}" not found: give its coordinates in the places of content.load, or add this marker to the level`);
      const ox = p.x ?? 0, oz = p.z ?? 0, c = Math.cos(base?.rot ?? 0), s = Math.sin(base?.rot ?? 0);
      const x = (base?.x ?? 0) + ox * c + oz * s, z = (base?.z ?? 0) - ox * s + oz * c, floor = p.floor ?? base?.y;
      if (floor === undefined && p.y === undefined) return { x, z };
      return { x, y: placeY(e, `content.where(${JSON.stringify(p.place ?? { x: p.x, z: p.z })})`, x, z, floor) + (p.y ?? 0), z };
    },
    /** @internal The floor a position notation stands on (its own floor, else its marker's height); undefined = top layer */
    _floorOf(p) { return p.floor ?? (p.place ? api.place(p.place)?.y : undefined); },
    /** @internal The facing of an entry: its own rot on top of its place's; undefined = neither is written, so the record stays without rot */
    _facingOf(p) { const r = p.place ? api.place(p.place)?.rot : undefined; return r === undefined ? p.rot : r + (p.rot ?? 0); },
  };
  return {
    name: 'content', type: 'rules', label: 'Content',
    optional: ['level', 'calendar', 'inventory', 'pickups', 'quests', 'particles', 'hud', 'vegetation', 'dialogue', 'triggers', 'collision', 'world', 'interactions', 'grids', 'rigid'],
    install(engine, ctx) { engine.i18n.add({ 'zh-CN': { 'module.content': '内容' }, en: { 'module.content': 'content' } });
      e = engine;
      st.track = ctx.track;   // loader.js subscribes on the first content.load: those listeners belong to the module too
      engine.explainWith(contentExplain);
      e.saves.register('content', {
        save: () => ({ marks: [...st.marks].map(([id, [v, label]]) => [id, v, label]) }),
        load: d => { for (const id of [...st.marks.keys()]) api._mark(id, null); for (const [id, v, label] of d?.marks || []) api._mark(id, v, label ?? undefined); },
      });
      // content may name ops that main.js defines after load: check once everything is set up, and again for loads after that
      const check = () => {
        for (const name of st.ops) if (!e.ops.defs.has(name)) throw codedError('unknown-name', `content: ${missingText('op', name, [...e.ops.defs.keys()])} (used in { op } / { can })`);
      };
      ctx.track(e.events.on('engine:ready', check));
      st.checkOps = () => { if (e.ready) check(); };
      return api;
    },
    isReady() { return api.ready; },
    // ?at=<place> / applyState({ at }): this module owns the names, core does the placing with what it gets back. An unknown name stops here: a picture of the
    // spawn point taken for "the pier" would look fine and be wrong
    applyState(e, { at }) {
      if (at == null) return;
      const p = api.place(at);
      if (!p) throw codedError('content-place', `applyState({ at: '${at}' }): no such place. Places: ${Object.keys(places).join(', ') || '(none loaded)'}; a level marker works too`);
      return p;
    },
    describe() {
      return { props: e.world ? e.world.query({ kind: 'prop' }).length : 0, templates: [...st.templates.keys()], markers: api.markers.size };
    },
  };
}
