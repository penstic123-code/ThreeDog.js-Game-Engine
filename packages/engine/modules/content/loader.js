// Content loading: hands the plain data of content/*.js to the modules (items, pickups, vegetation, NPCs, dialogues, quests, key actions, trigger zones,
// props).
// Position notation: { place: 'home', x: 1, z: 5 } = offset from place home; places come from the places argument of load or level markers; without place it is
// a world coordinate.
// Optional floor (reference height on multi-layer ground) and y (meters above that ground): see content.where.
import { toast } from '../../ui/UI.js';
import { parseClock } from '../../core/dayTime.js';
import { cachedModel } from './models.js';
import { addProps, needWorld } from './props.js';
import { defineTemplates } from './templates.js';
import { srcOf, applyRenames, pickupId } from './ids.js';
import { DEV, checkOptions } from '../../core/validate.js';
import { NO_GAME_EFFECTS, contentFiles, kindProblems, unknownContent, list } from './rules.js';

const each = (o, fn) => Object.entries(o || {}).forEach(([k, v]) => fn(k, v));
const all = (o, fn) => Object.entries(o || {}).every(([k, n]) => fn(k, n));

/** The inventory for the item words (has / lacks / give / take); without the module, a clear error instead of a TypeError deep inside */
const inv = (e, word) => e.inventory ?? (() => { throw new Error(`content word { ${word} } needs the inventory module: add inventory() to engine.use(...), `
  + 'or track the thing with a flag / counter ({ setFlag } / { bump }) or a game condition word instead'); })();

/** Execution part of the engine's built-in words (descriptions are in rules.js) */
export const BUILTIN_TESTS = {
  can: (e, v) => e.ops.can(v[0], v[1] ?? {}).ok,
  flag: (e, v) => !!e.vars.flag(v),
  notFlag: (e, v) => !e.vars.flag(v),
  has: (e, v) => all(v, (id, n) => inv(e, 'has').has(id, n)),
  lacks: (e, v) => all(v, (id, n) => !inv(e, 'lacks').has(id, n)),
  counter: (e, v) => all(v, (k, n) => e.vars.counter(k) >= n),
};
export const BUILTIN_RUNS = {
  op: (e, v) => { e.ops.run(v[0], v[1] ?? {}); },  setFlag: (e, v) => e.vars.setFlag(v),
  give: (e, v) => each(v, (id, n) => inv(e, 'give').add(id, n)),
  take: (e, v) => each(v, (id, n) => inv(e, 'take').remove(id, n)),
  bump: (e, v) => e.vars.bump(v),
  startQuest: (e, v) => e.quests.start(v),
  toast: (e, v) => toast(e, v),
  particles: (e, v) => e.particles.emit(v.name, v.at, { count: v.count }),
  marker: (e, v, raw) => {   // running the same marker again: remove the old one first (otherwise the old marker stays on screen)
    const id = markerId(raw);
    e.content.markers.get(id)?.remove();
    e.content.markers.set(id, e.hud?.marker(v, { label: raw.label }));
  },
  clearMarker: (e, v, raw) => { const id = markerId(raw); e.content.markers.get(id)?.remove(); e.content.markers.delete(id); },
};
const markerId = raw => raw.id ?? (typeof raw === 'string' ? raw : raw.place ?? `${raw.x},${raw.z}`);

/**
 * Load one content pack. c is the merged object of content/index.js (or one pack of a list); api is engine.content; ids is the IdCheck shared by every pack of
 * this load call (ids.js); st is the content module's load state (shared across repeated load calls):
 * { triggers: merged trigger table, subs: listener handles, startOn: quest id -> listener handle, pending: set of model Promises being generated,
 * levelPlace(name) }
 * Order: vocabulary -> key actions -> vegetation -> items -> containers -> pickups -> NPCs -> dialogues -> quests -> trigger zones -> templates -> props.
 * Pickups, props and NPCs are initial world data: the save records only changes and removals, independent of load order (rules at the top of world/World.js).
 * Positions that use level markers (not in places) belong to the current level: pickup, prop and NPC data carry a zone (= current level name,
 * engine.world.zone),
 * a level change only tears down models and they are rebuilt on return, with taken / moved / removed state intact; trigger zones are not data and are removed
 * on level change (level.track).
 */
export function loadContent(e, api, c, st, ids) {
  const { where } = api;
  const origin = (id, list, key) => { if (DEV) e.world?.setOrigin(id, { definedAt: srcOf(list, key) }); };
  const onLevel = (...ps) => ps.some(p => p && typeof p === 'object' ? st.levelPlace(p.place) : st.levelPlace(p));
  const bind = (h, ...ps) => { if (h && onLevel(...ps)) e.level?.track(h); return h; };
  const zoneOf = (...ps) => onLevel(...ps) ? e.world?.zone ?? null : null;

  each(c.rules?.conditions, (name, d) => api.condition(name, d));
  if (c.rules?.effects) throw new Error(NO_GAME_EFFECTS);
  // game kinds stay registered across loads, so a later content.load({ recipes }) without rules still finds them
  const bad = kindProblems(c.rules);
  if (bad.length) throw new Error('content/rules.js: ' + bad.join('; '));
  Object.assign(st.kinds, c.rules?.kinds);
  const known = contentFiles({ kinds: st.kinds });
  for (const k of Object.keys(c)) if (k !== 'name' && !known[k]) throw new Error('content.load: ' + unknownContent(k, { kinds: st.kinds }));
  collectOps(c, st.ops);

  if (c.renames) applyRenames(e, c.renames);   // first: saved state under an old id must reach the new id before anything is placed under it

  each(c.actions, (name, a) => e.input.define(name, a.keys, a.label));

  // audio: sounds / footsteps by name into engine.audio.config, rules to ambience() / music() (core/audioRules.js). A pack loaded again
  // replaces its own rules (hot reload): a named pack by its name, an unnamed one by the data object itself, so loading the same object
  // twice never stacks its rules (a fresh key per load did); two different unnamed objects both keep theirs
  if (c.audio) e.audio.contentPack(c.name ? 'pack:' + c.name : c, c.name ? `pack "${c.name}"` : 'pack (no name)', c.audio);

  // vegetation: generator models go through assets.cached (baked file -> dev cache -> compute), file models give their first mesh's geometry; register all
  // kinds at the same moment once all models are ready
  // (each registration rebuilds terrain chunks; registering one by one would rebuild several times at start). content's isReady waits for them
  const veg = [];
  each(c.vegetation, (name, { model: m, lod, ...rest }) => {
    const geo = x => cachedModel(e, x) ?? e.assets.geometry(list(x)[0]);
    veg.push(Promise.all([geo(m), lod && geo(lod)]).then(([geometry, lodGeometry]) => [name, { ...rest, geometry, ...(lodGeometry && { lodGeometry }) }])
      .catch(err => { console.error(`[content] vegetation ${name}: model generation failed`, err); return null; }));   // one failure does not affect the others
  });
  if (veg.length) st.wait(Promise.all(veg).then(list => { for (const v of list) if (v) e.vegetation.add(v[0], v[1]); }));

  each(c.items, (id, d) => e.inventory.define(id, d));
  each(c.startItems, (id, n) => e.inventory.add(id, n, { silent: true }));
  // containers: starting goods are placed only the first time (if the save already has the container, the save wins; no refill after it was emptied and
  // reloaded)
  each(c.containers, (id, d) => { ids.claim(id, `containers.${id}`); e.inventory.container(id, { capacity: d.capacity, items: d.items }); });
  // pickups: data goes into world (kind 'pickup'). id: the written id if given, else `pickup:<item>:<index in the pickups array>` (stable for the same content;
  // when inserting in the middle, give existing entries an id)
  if (c.pickups?.length) needWorld(e);
  c.pickups?.forEach((p, i) => {
    const id = pickupId(p, i);
    if (p.id != null) ids.claim(id, `pickups[${i}] (${p.item})`); else ids.unnamed(id, `pickups[${i}] (${p.item})`);   // taken / respawning is state
    e.inventory.spawnPickup(p.item, where(p), { id, count: p.count, data: p.data, radius: p.radius, auto: p.auto, respawnSeconds: p.respawn, initial: true, zone: zoneOf(p) });
    origin(id, c.pickups, i);
  });

  const hpd = e.sky?.hoursPerDay ?? 24;
  each(c.npcs, (id, n) => {   // the key in content is the NPC's stable id (used by saves and quest targets)
    const plan = n.schedule ?? [];
    ids.claim(id, `npcs.${id}`);
    // every documented npcs.add option can be written in content (arriveDistance, talkRadius, speed...); the same option table checks the spelling.
    // The content form owns start / schedule (clock strings, places) and the id (the key), so those are translated below and not passed as written
    checkOptions(`content npcs.${id}`, n, [...e.npcs.optionKeys.filter(k => !['id', 'position', 'zone', 'initial'].includes(k)), 'start']);
    const { start: _s, schedule: _p, ...rest } = n;
    e.npcs.add({ ...rest, id, schedule: plan.map(s => ({ at: parseClock(s.at, hpd), position: where(s) })), position: where(n.start || plan[0]), zone: zoneOf(n.start, ...plan), initial: true });
    origin(id, c.npcs, id);
  });

  // dialogue: a line can be several variants [{ if: condition, text }, ..., { text }]; the first whose condition holds is used
  each(c.dialogues, (id, d) => {
    const nodes = {};
    each(d.nodes, (nid, n) => {
      nodes[nid] = {
        ...n, speaker: n.speaker ?? d.speaker,
        text: Array.isArray(n.text) ? () => n.text.find(v => api.test(v.if)).text : n.text,
        do: n.do && (() => api.run(n.do)),
        choices: n.choices?.map(ch => ({ ...ch, if: ch.if && (() => api.test(ch.if)), do: ch.do && (() => api.run(ch.do)) })),
      };
    });
    e.dialogue.define(id, nodes);
  });

  // quests: a step target can be a place, { place, x, z }, { x, z }, { npc: 'id' } (follows the NPC) or { nearest: itemId } (the nearest pickup)
  // { npc } reads the position by id each frame: follow the model if there is one, else (far away, other level) use the data position
  const target = t => t == null ? undefined : t.npc ? () => e.npcs?.get(t.npc)?.position : t.nearest ? t : where(typeof t === 'string' ? { place: t } : t);
  // a step may be parallel goals { text?, all: [{ text, done, target, optional }] }; fail / onFail are a condition and an effect like done / reward
  const goal = s => ({ ...(s.id != null && { id: s.id }), text: s.text, done: () => api.test(s.done), target: target(s.target), ...(s.optional && { optional: true }) });   // id: stable for saves
  each(c.quests, (id, q) => {
    e.quests.define(id, {
      title: q.title, desc: q.desc,
      steps: q.steps.map(s => s.all ? { ...(s.id != null && { id: s.id }), text: s.text, all: s.all.map(goal) } : goal(s)),
      reward: q.reward && (() => api.run(q.reward)),
      ...(q.fail && { fail: () => api.test(q.fail) }), ...(q.onFail && { onFail: () => api.run(q.onFail) }),
    });
    st.startOn.get(id)?.remove();   // loading the same quest again: replace the old listener instead of attaching twice
    if (q.startOn) st.startOn.set(id, e.events.on(q.startOn, () => e.quests.start(id)));
  });

  // trigger zones: fromLevel = the level's trigger_<tag> marker; otherwise placed by position. Enter/exit effects look up the merged table, and the listener is
  // attached only once
  if (c.triggers) {
    Object.assign(st.triggers, c.triggers);
    if (Object.values(c.triggers).some(t => t.fromLevel)) e.triggers.fromMarkers();
    each(c.triggers, (tag, t) => {
      if (!t.fromLevel) bind(e.triggers.add({ ...t, tag, position: where(t.position), onEnter: null, onExit: null }), t.position);
    });
    st.subs ??= [
      e.events.on('trigger:enter', ({ tag }) => api.run(st.triggers[tag]?.onEnter)),
      e.events.on('trigger:exit', ({ tag }) => api.run(st.triggers[tag]?.onExit)),
    ];
  }

  // grids (layout rules, not saved) before props: a props entry with grid places an item on one; a repeated load keeps the grid that exists
  each(c.grids, (name, g) => {
    if (!e.grids) throw new Error(`content grids: install grids() to use grid "${name}"`);
    if (!e.grids.get(name)) e.grids.add(name, g);
  });
  // templates before props: a props entry with template places an instance of it
  if (c.templates) { needWorld(e); defineTemplates(e, api, st, c.templates); }
  // props: data goes into world (kind 'prop'); models and collision are built nearby and torn down when far by present in props.js
  if (c.props?.length) addProps(e, api, c.props, st, zoneOf, ids);

  // game kinds last: their data may name the items, NPCs and places loaded above
  each(st.kinds, (name, k) => { if (c[name] !== undefined) k.load(e, c[name], api); });
}

/** Op names that content data refers to ({ op: [...] } / { can: [...] } anywhere), checked against engine.ops once the game is ready */
function collectOps(v, out, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return;
  if (!Array.isArray(v)) for (const k of ['op', 'can']) if (Array.isArray(v[k]) && typeof v[k][0] === 'string') out.add(v[k][0]);
  for (const x of Array.isArray(v) ? v : Object.values(v)) collectOps(x, out, depth + 1);
}
