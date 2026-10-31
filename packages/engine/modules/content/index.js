// Content loader: hands the plain data in the game's content/*.js to the engine (items, pickups, vegetation, NPCs, dialogues, quests, key actions, trigger zones, props).
//   engine.use(content());
//   engine.assets.manifest(lowpolyAssets);                      // models content names (an asset pack; content never holds paths or code)
//   engine.content.load(data, { places: { home: { x, z } } });  // or several packs at once: load([base, dlc, level]) (packs.js)
// Condition/effect vocabulary is in rules.js. Games add condition words (content/rules.js, or content.condition(name, { test }) in code);
// a game's own actions are ops, called from content with { op: ['noun.verb', args] } and tested with { can: [...] }.
// Op names used in content are checked when the game becomes ready (did you mean...).
// Templates (content/templates.js): reusable objects placed from props.js ({ template, x, z }) or engine.content.spawn; see templates.js.
// Props (content/props.js) and pickups (pickups.js) are stored in engine.world (requires world(); openWorld() includes it; see props.js for the stable id rule),
// models and collision are built only near the focus; move / remove with engine.world.move / remove, saved with the save. Procedural models of vegetation and props go through engine.assets.cached (name = model name):
// baked files from npm run bake are read from file, otherwise cached automatically in dev. Models arrive asynchronously: the loading screen of start() waits for them (isReady) before the game counts as ready.
// Repeated load: a quest's startOn and a trigger's enter/exit effects do not attach listeners twice (the later load overrides the same name).
// Pickups, props and NPCs are initial world data: the save records only changes and removals, so content.load before or after loading a save gives the same result.
// Positions that use level markers belong to the current level: the data carries a zone, and a level change only tears down models (pickups taken and removals are remembered); trigger zones are removed on level change.
import { warnMissing, missingText } from '../../core/validate.js';
import { reportError } from '../../core/errors.js';
import { parseClock } from '../../core/dayTime.js';
import { CONDITIONS, EFFECTS, list } from './rules.js';
import { loadContent, BUILTIN_TESTS, BUILTIN_RUNS } from './loader.js';
import { templateOf, spawnTemplate, placeTemplate } from './templates.js';
import { packsOf } from './packs.js';
import { IdCheck } from './ids.js';

export function content() {
  let e = null, places = {};
  // load state (shared across repeated load calls): see loader.js
  const pending = new Set();
  const st = {
    triggers: {}, subs: null, startOn: new Map(), ops: new Set(), kinds: {},
    templates: new Map(), templateViews: new Set(),   // template name -> frozen definition; names whose presenter is registered
    templateSrc: new Map(),                           // dev: template name -> 'content/templates.js:12'
    levelPlace: name => !!name && !(name in places) && !!e.level?.marker(name),
    wait: p => { pending.add(p); p.catch(err => reportError(e, err, 'content model', { soft: true })).finally(() => pending.delete(p)); },
  };
  const conds = new Map(Object.entries(CONDITIONS).map(([k, d]) => [k, { ...d, test: BUILTIN_TESTS[k] }]));
  const effects = new Map(Object.entries(EFFECTS).map(([k, d]) => [k, { ...d, run: BUILTIN_RUNS[k] }]));
  // convert content notation to runtime values by ref (clock time -> fraction, place -> { x, z })
  const norm = (ref, v) => ref === 'clock' ? parseClock(v, e.sky?.hoursPerDay ?? 24) : ref === 'position' ? api.where(typeof v === 'string' ? { place: v } : v) : v;

  const api = {
    /** All vegetation models are ready and the models of nearby world data such as props are built (world.ready) */
    get ready() { return pending.size === 0 && (!e.world || e.world.ready); },
    /** marker markers added by the marker effect: id -> hud marker */
    markers: new Map(),
    /**
     * Load content data: one pack (the object of content/index.js) or a list of packs loaded together in order, where an id defined by two packs is an error (packs.js).
     * Models are asset names (engine.assets.manifest / an asset pack), never paths. places: place name -> position
     * @example engine.content.load([baseContent, forestDlc], { places: { home: { x: 0, z: 0 } } })
     * @param {any} data
     * @param {{ places?: Record<string, any> }} [opts]
     */
    load(data, { places: pl = {} } = {}) {
      Object.assign(places, pl);
      const packs = packsOf(data), ids = new IdCheck();   // one IdCheck for the whole call: an id used in two packs' props / pickups is an error too
      e.ops.allow(() => { for (const p of packs) loadContent(e, api, p, st, ids); });   // loading data is setup, not a gameplay action (ops guard)
      ids.done();
      st.checkOps?.();
      return api;
    },
    /** Register a condition word: condition('timeAfter', { ref: 'clock', desc, test: (e, value) => ... }) */
    condition(name, def) { conds.set(name, def); return api; },
    /** Whether a condition holds (object = all listed items hold, array = every item holds, function = called directly) */
    test(c) {
      if (!c) return true;
      if (typeof c === 'function') return !!c(e);
      return list(c).every(x => Object.entries(x).every(([k, v]) => {
        const d = conds.get(k);
        if (!d) { warnMissing('condition', k, [...conds.keys()]); return false; }
        return !!d.test(e, norm(d.ref, v), v);
      }));
    },
    /** Run an effect (object, array or function) */
    run(a) {
      if (!a) return;
      if (typeof a === 'function') return a(e);
      for (const x of list(a)) for (const [k, v] of Object.entries(x)) {
        const d = effects.get(k);
        if (!d) { warnMissing('effect', k, [...effects.keys()]); continue; }
        d.run(e, norm(d.ref, v), v);
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
     * Place a new instance of a template at runtime (a gameplay change: call it inside an op or a fixed step); saved whole.
     * Returns the world record (kind = template name). at is a ground position ({ x, z }, [x, y, z] or an object);
     * fields may set id, rot, scale, y (height above ground), items (container start goods) and the template's state fields.
     * @example engine.ops.define('chest.build', { run: (e, { x, z }) => e.content.spawn('chest', { x, z }, { items: { stick: 3 } }).id });
     * @param {string} name
     * @param {any} at
     * @param {Record<string, any>} [fields]
     * @returns {import('../world/World.js').WorldRecord}
     */
    spawn(name, at, fields) { return spawnTemplate(e, st, name, at, fields); },
    /**
     * @internal A level-model node with the custom property template: an authored instance with id `<level>/<node>` (level module).
     * entry is a props-style entry ({ template, id, x, z, floor, rot, scale, state fields }); origin = { level, node }
     */
    placeNode(entry, zone, origin) { placeTemplate(e, api, st, entry, 0, zone, null, origin); },
    /** @internal dev: where a template is defined ('content/templates.js:12'), null if unknown */
    templateSource(name) { return st.templateSrc.get(name) ?? null; },
    /** Place name -> position { x, z } plus y when the place has a height (level markers, places given with y); null if not found */
    place(name) {
      const p = places[name] ?? e.level?.marker(name)?.position;
      return p ? { x: p.x, z: p.z, ...(p.y !== undefined && { y: p.y }) } : null;
    },
    /**
     * Position notation in content { place?, x?, z?, floor?, y? } -> world coordinates { x, z }, plus y when the notation pins a height.
     * floor: reference height for multi-layer ground (second storey, bridge deck, lower dungeon level): it stands on the highest layer not above floor;
     * a level-marker place lends its own height as floor. y: meters above that ground (shelves, floating pickups).
     * Without floor / y / a marker height the result is { x, z } and the thing sits on the top layer.
     * @example engine.content.where({ place: 'tower', x: 1, floor: 6 })   // the tower's second floor, not its roof
     */
    where(p) {
      const base = p.place ? api.place(p.place) : null;
      if (p.place && !base) throw new Error(`Place "${p.place}" not found: give its coordinates in the places of content.load, or add this marker to the level`);
      const x = (base?.x ?? 0) + (p.x ?? 0), z = (base?.z ?? 0) + (p.z ?? 0), floor = p.floor ?? base?.y;
      if (floor === undefined && p.y === undefined) return { x, z };
      return { x, y: e.surface(x, z, floor) + (p.y ?? 0), z };
    },
    /** @internal The floor a position notation stands on (its own floor, else its marker's height); undefined = top layer */
    _floorOf(p) { return p.floor ?? (p.place ? api.place(p.place)?.y : undefined); },
  };
  return {
    name: 'content', label: 'Content',
    optional: ['level', 'sky', 'inventory', 'quests', 'particles', 'hud', 'vegetation', 'dialogue', 'triggers', 'collision', 'world', 'interactions', 'grids', 'rigid'],
    install(engine) {
      e = engine;
      // content may name ops that main.js defines after load: check once everything is set up, and again for loads after that
      const check = () => {
        for (const name of st.ops) if (!e.ops.defs.has(name)) throw new Error(`content: ${missingText('op', name, [...e.ops.defs.keys()])} (used in { op } / { can })`);
      };
      e.events.on('engine:ready', check);
      st.checkOps = () => { if (e.ready) check(); };
      return api;
    },
    isReady() { return api.ready; },
    describe() {
      return { props: e.world ? e.world.query({ kind: 'prop' }).length : 0, templates: [...st.templates.keys()], markers: api.markers.size };
    },
  };
}
