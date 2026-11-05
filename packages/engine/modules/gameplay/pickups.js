// Pickups: ground items any actor takes.
// Things lying on the ground that whoever takes them gets. Installed as engine.pickups; needs world() (the data are plain kind 'pickup' records in
// engine.world, saved with it), interactions() for the key prompt, inventory() only for pickups that give an item.
//
// engine.use(world(), interactions({ ...presets.interactions.nearest }), inventory(), pickups());
// engine.pickups.spawn([3, 0, 5], { give: 'berry', count: 2, respawnSeconds: 120 });          // into the picker's bag (inventory.of(actor))
// engine.pickups.spawn([8, 0, 2], { give: (e, { actor }) => heal(actor, 25), name: 'Medkit', auto: true });   // instant effect: no inventory needed
//
// Why its own module (not part of inventory): a coin, a health pack or a power-up is "something on the ground that does a thing to who touches it"; only
// some games turn that into a bag entry. And who touches it is any actor: the local user, a net peer on the host, an NPC; the item goes into that actor's
// container, never a fixed 'player' bag. Taking is the op pickup.take (net: 'peer'), so a client's press is sent to the host and the host decides.
//
// Picture: shape = a model name from an asset pack: model option or the item's define(id, { model }), else a model named 'pickup:<item>', else 'pickup', else a
// gray box; pickups({ color, size, lift }) for the plain values; engine.pickups.material is the three.js material the box and geometry-only models draw with;
// spawn(pos, { mesh }) puts the game's own object down instead.
import * as THREE from 'three';
import { neutralMaterial } from '../../render/neutral.js';
import { copyPatches, isEngineMade, markEngineMade } from '../../render/patches.js';
import { xzOf } from '../../core/math.js';
import { placeY } from '../../core/ground.js';
import { warnOnce, needMaterial } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { copyData } from './Container.js';
import { failure } from '../../core/opsFail.js';
import { protoOf } from '../../core/namedModel.js';
import { shadowDefaults } from '../../core/assetEntry.js';
import { codedError, coded } from '../../core/errorHints.js';

const STRINGS = { 'zh-CN': { 'module.pickups': '拾取物', 'pickups.take': '捡起 {name}' }, en: { 'module.pickups': 'pickups', 'pickups.take': 'Pick up {name}' } };
const SPAWN_KEYS = ['give', 'count', 'data', 'name', 'model', 'color', 'mesh', 'respawnSeconds', 'bob', 'id', 'initial', 'zone', 'radius', 'auto'];
const NO_ACTORS = [];
const DEFAULT_COLOR = 0xcccccc;
// A net host measures peers at the position they last sent (a few steps old): pickup.take allows this much beyond the radius so a fair press is not refused
const NET_SLACK = 1;

export class Pickups {
  /** @internal track: the module's ctx.track */
  constructor(engine, { radius = 2, showDistance = 60, takers, color = DEFAULT_COLOR, size = 0.25, lift = 0.4 } = {}, track) {
    this.engine = engine;
    /** Edge of the placeholder box (meters), read when one is built */ this.size = size;
    /** Height above the ground new pickups float at (meters) */ this.lift = lift;
    /** @internal */ this._material = neutralMaterial('pickup', { color });
    /** @internal copies of the material for a pickup's own color or a vertex-colored geometry: 'color' or 'color:vc' -> material */ this._copies = new Map();
    /** Reach of pickups that set no radius (meters); auto pickups are taken within it */ this.radius = radius;
    /** @internal pickups float, spin and have a model only within this distance of the stream sources */ this.showDistance = showDistance;
    /**
     * Who can walk into auto pickups: () => actor ids. Default: engine.actor, plus every net peer on a host; none on a net client (the host takes them for it,
     * from the positions it is sent). A game with NPCs that collect coins returns their ids too.
     * @type {(e: any) => string[]}
     */
    this.takers = takers ?? (e => e.net?.role === 'client' ? NO_ACTORS : e.net ? [e.actor, ...e.net.peers.map(p => p.actor)] : [e.actor]);
    // world id -> what cannot go in saved data: the game's mesh, a give function. Spawning the same id again (content / setup code on load) sets them again
    /** @internal */ this._live = new Map();
    // the reach query around each taker uses the largest auto radius in the world, read from the records rather than from spawn calls:
    // auto pickups loaded from a save in a fresh page, or a saved one wider than this session's spawns, must be reached too
    /** @internal largest radius of the auto pickups in the world (0 = none) */ this._autoR = 0;
    /** @internal pickup records changed since _autoR was read */ this._autoDirty = true;
    const dirty = ({ kind }) => { if (kind === 'pickup') this._autoDirty = true; };
    track(engine.events.on('world:add', dirty)); track(engine.events.on('world:change', dirty));
    engine.i18n.add(STRINGS);
    // a record gone (taken without respawn, removed, not in a loaded save): its live parts are no longer needed for a rebuild
    track(engine.events.on('world:remove', ({ id, kind }) => { this._live.delete(id); dirty({ kind }); }));
    track(engine.events.on('world:load', () => { this._autoDirty = true; for (const id of this._live.keys()) if (!engine.world.get(id)) this._live.delete(id); }));
    present(this);
  }

  /**
   * The three.js material of every placeholder box and geometry-only model. Set it to swap the look of all of them at once; it is used as given, with no patches added.
   * A pickup with a color of its own (spawn({ color }), inventory.define(id, { color })) or a vertex-colored geometry draws with a copy of it carrying that color.
   * A file model and a generator's own Object3D keep their materials.
   * @example engine.pickups.material = new THREE.MeshStandardMaterial({ color: 0xffd24a, metalness: 0.8, roughness: 0.3 });
   * @type {THREE.Material}
   */
  get material() { return this._material; }
  set material(m) {
    needMaterial('pickup-misuse', 'engine.pickups.material', m, '. Example: engine.pickups.material = new THREE.MeshStandardMaterial({ color: 0xffd24a })');
    const old = this._material;
    if (m === old) return;
    this._material = m;
    for (const c of this._copies.values()) c.dispose();
    this._copies.clear();
    if (isEngineMade(old)) old.dispose();   // a material the game gave stays the game's
    const w = this.engine.world;
    // only what is built now: a pickup out of reach has no model, and one built later asks for the current material
    for (const r of w.query({ kind: 'pickup' })) w.view(r.id)?.traverse(o => { if (o.userData.pickupColor !== undefined) /** @type {any} */ (o).material = pickupMaterial(this, o); });
  }

  /**
   * Place a pickup at position. give: an item id (goes into the picker's container, inventory.of(actor); needs inventory()) or a function
   * (e, { actor, pickup }) => result for an instant effect (heal, score, power-up; no inventory needed). Returning { ok: false, code } (failure(code)) leaves it
   * on the ground and fails the pickup.take op with that code; an item that does not fit fails with 'full'.
   * Walk up and press the interact key to take it (needs interactions()); auto: true takes it by walking into it, for every actor in takers.
   * The data is a plain world record of kind 'pickup' ({ id, item?, count, data?, name?, model?, color?, radius?, auto?, bob, respawn?, until?, zone?,
   * position }, saved). A give function and a mesh are not data: they live in memory under the world id, so code that spawns one spawns it again on load
   * (content and setup code do; a runtime drop gives an item id).
   * id: without it, auto-numbered (pickup-1...); give a stable id to recognize one in saves (content pickups use `pickup:<item>:<index>`). Existing data with
   * the same id is reused. initial: true = written in content (needs an id; the save records only taken / waiting to respawn); zone = which level it belongs to.
   * count / data = how many pieces and the pieces' own data (a dropped sword keeps its durability); name = shown in the prompt (default the item's name);
   * radius = reach in meters (default pickups({ radius }), 2).
   * Returns a handle { id: world id, give, object: current model (null when far), remove() }.
   * @example engine.pickups.spawn([3, 0, 5], { give: 'berry', count: 2, respawnSeconds: 120 })
   * @example engine.pickups.spawn([8, 0, 2], { give: 'ammo', count: 30, auto: true, radius: 1.2 })   // taken on touch, by whoever touches it
   * @example engine.pickups.spawn(p, { give: (e, { actor }) => e.ops.run('hp.heal', { n: 25 }, { actor }), name: 'Medkit', model: 'medkit', auto: true })
   * @param {any} position
   * @param {Record<string, any>} opts
   */
  spawn(position, opts) {
    readParams('pickups.spawn()', keysSchema(SPAWN_KEYS), opts);
    const e = this.engine, w = e.world, give = opts?.give;
    const item = typeof give === 'string' ? give : null;
    if (!item && typeof give !== 'function') throw codedError('pickup-misuse', `pickups.spawn(): give is an item id ('berry') or a function (e, { actor }) => result, got ${JSON.stringify(give) ?? typeof give}`);
    if (item && !e.inventory) throw codedError('pickup-misuse', `pickups.spawn({ give: '${item}' }): an item pickup goes into the picker's container, so it needs inventory() installed; for an instant effect pass give: (e, { actor }) => ...`);
    const [x, z] = xzOf(position);
    // a given y is the reference height on multi-layer ground (as snapToGround): a pickup on a bridge deck or a second floor stays there; without one it sits on the top layer
    const p = /** @type {any} */ (position).isObject3D ? /** @type {any} */ (position).position : position, refY = Array.isArray(p) ? p[1] : p.y;
    const { count = 1, mesh = null, respawnSeconds = 0, bob = true, id, initial = false, zone, radius, auto = false, name, model: m, color } = opts;
    const what = item ?? name ?? 'pickup';
    if (radius != null && !(radius > 0)) throw codedError('pickup-misuse', `pickups.spawn('${what}'): radius must be a positive number of meters, got ${radius}`);
    const data = copyData('pickups.spawn', what, opts.data);
    const def = { id, kind: 'pickup', ...(item && { item }), count, bob, ...(data && { data }), ...(name != null && { name }), ...(m != null && { model: m }), ...(color != null && { color }),
      ...(radius != null && { radius }), ...(auto && { auto: true }), ...(respawnSeconds > 0 && { respawn: respawnSeconds }), ...(zone != null && { zone }),
      position: [x, placeY(e, `pickups.spawn('${what}')`, x, z, refY) + this.lift, z] };
    const rec = initial ? w.add(def, { initial }) : id != null && w.get(id) || w.add(def);   // initial data: world decides whether it exists / was deleted from the save (null)
    if (rec && (rec.kind !== 'pickup' || (rec.item ?? null) !== item)) throw codedError('world-id', `pickup id '${id}' is already used by other data (${rec.kind}${rec.item ? ' ' + rec.item : ''}): use a different id`);
    const wid = rec?.id ?? id;
    if (mesh || !item) this._live.set(wid, { mesh, give: item ? null : give });
    return { id: wid, give, get object() { return w.view(wid); }, remove: () => { w.remove(wid); this._live.delete(wid); } };
  }

  /** Pickup data still on the ground nearest to from (default engine.actorPosition()), of one item id or any (item omitted); null if none (hud's { nearest }). */
  nearest(item, from) {
    const w = this.engine.world, f = from ?? this.engine.actorPosition();
    if (!f) return null;
    let best = null, bd = Infinity;
    for (const r of w.query({ kind: 'pickup', where: r => (item == null || r.item === item) && r.until == null })) {
      const dx = r.position.x - f.x, dy = r.position.y - (f.y ?? 0), dz = r.position.z - f.z, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }

  /** @internal The shown name of a record: its own name, else the item's name */
  _name(rec) { return rec.name ?? (rec.item ? this.engine.inventory?.item(rec.item).name ?? rec.item : 'pickup'); }

  /**
   * @internal pickup.take's run: give to actor, then off the ground. Returns { ok: true, value } or the failure that keeps it on the ground.
   * The item goes into the actor's own container (inventory.of(actor)): the local user's bag, a net peer's bag on the host, an NPC's.
   */
  _take(rec, actor) {
    const e = this.engine, W = e.world;
    let value;
    if (rec.item) {
      if (!e.inventory) return failure('noInventory');
      const put = e.inventory.of(actor).add(rec.item, rec.count, rec.data && { data: rec.data });
      if (!put.ok) return put;
      value = put.key;
    } else {
      const fn = this._live.get(rec.id)?.give;
      if (!fn) { warnOnce(`pickups: '${rec.id}' gives with a function, which is not saved data; spawn it again with the same id after a load (content and setup code do)`); return failure('noGive'); }
      value = fn(e, { actor, pickup: rec });
      if (value && value.ok === false) return value;
    }
    // without respawn the record is deleted; with respawn time it gets until (show tears down the model), saved so the countdown continues after a load
    if (rec.respawn > 0) W.set(rec.id, { until: e.clock.now + rec.respawn });
    else W.remove(rec.id);   // world:remove drops the live parts
    e.events.emit('pickup:take', { pickup: rec.id, item: rec.item ?? null, count: rec.count, actor, x: rec.position.x, z: rec.position.z });
    return { ok: true, value };
  }

  /** @internal Fixed step: every taker walks into the auto pickups in its reach (any actor, not only engine.actor) */
  _auto() {
    const e = this.engine, w = e.world;
    if (this._autoDirty) {
      this._autoDirty = false; this._autoR = 0;
      for (const r of w.query({ kind: 'pickup', where: r => r.auto })) this._autoR = Math.max(this._autoR, r.radius ?? this.radius);
    }
    if (!this._autoR) return;
    for (const actor of this.takers(e)) {
      const p = actor === 'player' && !e.player ? null : e.actorPosition(actor);   // no player body: the camera focus is not someone walking
      if (!p) continue;
      const near = w.query({ kind: 'pickup', near: p, radius: this._autoR, where: r => r.auto && r.until == null });
      // can first: one that does not fit stays in reach every step, and only a real take belongs in the op history
      for (const rec of near) if (inReach(rec, p, rec.radius ?? this.radius) && e.ops.can('pickup.take', { id: rec.id }, { actor }).ok) e.ops.run('pickup.take', { id: rec.id }, { actor });
    }
  }
}

const inReach = (rec, p, r) => { const dx = rec.position.x - p.x, dy = rec.position.y - (p.y ?? 0), dz = rec.position.z - p.z; return dx * dx + dy * dy + dz * dz <= r * r; };

/** Register how pickups picture and respawn (once, on install) @internal */
function present(pk) {
  const e = pk.engine, w = e.world;
  w.present('pickup', {
    radius: pk.showDistance,
    show: rec => rec.until == null,   // waiting to respawn: no model
    build: rec => model(pk, rec),
    update: (rec, o) => {   // bobbing spin: world places the model at the data position each frame first, this adds the bob on top
      if (rec.bob === false) return;
      const t = e.time.now('real'), x = rec.position.x;
      o.rotation.y = t * 1.5 + x; o.position.y = rec.position.y + Math.sin(t * 2 + x) * 0.08;
    },
    // only detached: a game's mesh is the game's, a model clone shares geometry / material with its prototype (protoOf), the material is shared by every pickup;
    // the placeholder box is the one thing built here alone, so its geometry is freed
    dispose: (rec, o) => { o.userData.useHandle?.remove(); e.detach(o); o.traverse(c => { if (c.userData.ownGeometry) /** @type {any} */ (c).geometry.dispose(); }); },
  });
  // waiting to respawn: when due (game clock) clear until and return to the ground. Far ones are also checked once a second, so they grow back on time even when not nearby
  const wake = rec => { if (rec.until != null && e.clock.now >= rec.until) w.set(rec.id, { until: undefined }); };
  w.simulate('pickup', { near: wake, far: wake });
}

// A pickup's shape goes one way only: a model name from assets (same protoOf as content props / templates: file or code-generated, cache, bake and shadow rules are identical).
// Name order: the pickup's own model -> the item definition's model -> 'pickup:<item id>' in assets -> 'pickup' -> neutral grey-box placeholder (warns once).
const NO_PICKUP = "pickups: no model for '{item}', so it lies on the ground as a gray box (a placeholder). Register a model in an asset pack and name it: "
  + "pickups.spawn(p, { model: 'gem' }) / inventory.define('{item}', { model: 'gem' }), or call the model 'pickup:{item}' (this item) / 'pickup' (every pickup without its own)";
const NO_NAME = "pickups: '{item}' has model '{model}', but no asset pack registers a model of that name (engine.assets.manifest({ models: { {model}: fn | '/models/{model}.glb' } })); using the gray placeholder box";
const fill = (t, o) => t.replace(/\{(\w+)\}/g, (_, k) => o[k]);
/** Which model name a pickup shows (its own model, else the item's, else 'pickup:<item>' / 'pickup'), or null for the placeholder @internal */
function pickupModelName(e, item, model) {
  const has = n => { const x = e.assets.entries.get(n); return !!x?.named && x.type === 'model'; };
  const what = item ?? 'pickup';
  if (typeof model === 'string') { if (has(model)) return model; warnOnce(fill(NO_NAME, { item: what, model })); return null; }
  for (const n of item ? ['pickup:' + item, 'pickup'] : ['pickup']) if (has(n)) return n;
  warnOnce(fill(NO_PICKUP, { item: what }));
  return null;
}
/**
 * The model (built when near) + interaction for this pickup record @internal
 * Returns an empty group that is usable at once (interaction, floating and world placement are ready synchronously); the model arrives from protoOf asynchronously and is attached then:
 * file models must download and generators may read the dev cache, and none of that should make "a pickup nearby" appear a frame late.
 */
function model(pk, rec) {
  const e = pk.engine, def = rec.item && e.inventory ? e.inventory.item(rec.item) : {};
  let obj = pk._live.get(rec.id)?.mesh;
  if (obj) obj.castShadow = true;   // a mesh the game passed in stays the game's; only made to cast
  else {
    const color = rec.color ?? def.color ?? null, name = pickupModelName(e, rec.item ?? null, rec.model ?? def.model), holder = new THREE.Group();
    holder.name = name ?? 'pickup'; holder.userData.name = holder.name; obj = holder;
    const box = () => {   // the neutral placeholder: also what a model that failed to build falls back to
      const size = pk.size, m = shadowDefaults(new THREE.Mesh(new THREE.BoxGeometry(size, size, size)), {});
      m.userData.ownGeometry = true; drawnBy(pk, m, color); holder.add(m);
    };
    if (!name) box();
    else protoOf(e, pk, name).then(proto => {
      const o = proto.obj.clone();   // geometry / materials stay the prototype's (shadow flags were settled once there, as for content props)
      // generator gave only geometry: draw it with the pickups material in the item's own color (same color shares one); generators that return a full Object3D / file models stay as they are
      if (proto.fromGeometry) drawnBy(pk, o, color);
      holder.add(o);
    }).catch(err => { warnOnce(`pickups: model '${name}' of '${rec.item ?? rec.id}' failed to build (${err?.message ?? err}); showing the gray placeholder box`); box(); });
  }
  if (rec.auto) return obj;   // taken by walking into it: no key prompt
  if (!e.interactions) { warnOnce(coded('module-needs', 'Pickups without auto: true are taken with the interact key: install interactions() first.')); return obj; }
  obj.userData.useHandle = e.interactions.add(obj, {
    id: rec.id,
    label: () => e.t('pickups.take', { name: pk._name(rec) }), radius: rec.radius ?? pk.radius,
    enabled: () => e.world.get(rec.id) === rec && rec.until == null,
    // the op, not a direct take: on a net client it is sent to the host (which puts the item into this peer's bag); its result is interaction.use's value,
    // and a failure ('full') fails interaction.use with that code
    onUse: (o, { actor }) => e.ops.run('pickup.take', { id: rec.id }, { actor }),
  });
  return obj;
}

/** Mark a mesh as drawn by the pickups material (color: its own, or null) and give it that material @internal */
function drawnBy(pk, mesh, color) { mesh.userData.pickupColor = color; mesh.material = pickupMaterial(pk, mesh); }

/** The material of one marked mesh: pk.material itself, or a copy shared by every pickup of that color (and vertex colors or not) @internal */
function pickupMaterial(pk, mesh) {
  const color = mesh.userData.pickupColor, vc = !!mesh.geometry.attributes.color, base = pk.material;
  if (color == null && !vc) return base;
  const key = color + (vc ? ':vc' : '');
  if (!pk._copies.has(key)) {
    const m = copyPatches(base, base.clone());
    if (color != null) /** @type {any} */ (m).color?.set(color);
    if (vc) m.vertexColors = true;
    if (isEngineMade(base)) markEngineMade(m);
    pk._copies.set(key, m);
  }
  return pk._copies.get(key);
}

/** The op pickup.take { id }: the interact key, auto pickups, a net peer's request, the dev bridge and tests all run it, as ctx.actor @internal */
function defineTake(e, pk) {
  e.ops.define('pickup.take', {
    desc: "Take a pickup off the ground: its item goes into the actor's container (or its give function runs for the actor)",
    args: { id: 'string' },
    net: 'peer',   // a client's press is sent to the host, which runs it as that peer: the item lands in the peer's bag there and syncs back
    can(e, { id }, ctx) {
      const rec = e.world.get(id);
      if (!rec || rec.kind !== 'pickup') return 'unknown';
      if (rec.until != null) return 'respawning';
      const p = e.actorPosition(ctx.actor);
      if (!p) return 'noPosition';
      const bag = rec.item && e.inventory?.of(ctx.actor);   // room is optional on a replacement inventory's containers: without it, add() decides
      if (bag && typeof bag.room === 'function' && bag.room(rec.item, rec.data) < 1) return 'full';
      const r = (rec.radius ?? pk.radius) + (ctx.source === 'net' ? NET_SLACK : 0), r1 = v => Math.round(v * 10) / 10;
      // the same facts as interaction.use's tooFar: how far, the radius, where the pickup is
      return inReach(rec, p, r) ? true : { code: 'tooFar', facts: { distance: r1(Math.hypot(rec.position.x - p.x, rec.position.y - (p.y ?? 0), rec.position.z - p.z)), radius: r, at: { x: r1(rec.position.x), z: r1(rec.position.z) } } };
    },
    run(e, { id }, ctx) { return pk._take(e.world.get(id), ctx.actor); },
    reasons: { unknown: 'No pickup with this world id', respawning: 'Taken; waiting to respawn', noPosition: 'The actor has no position', tooFar: 'Actor is outside its radius',
      full: "It does not fit in the actor's container", noInventory: 'An item pickup needs inventory()', noGive: 'Its give function was not spawned again after a load' },
  });
}

const PICKUP_PARAMS = {
  radius: { type: 'number', default: 2, min: 0, desc: 'reach of pickups that set no radius (meters); auto pickups are taken within it' },
  showDistance: { type: 'number', default: 60, min: 0, desc: 'pickups have a model, float and spin only within this distance of the stream sources (meters)' },
  takers: { type: 'any', optional: true, desc: 'e => actor ids that walk into auto pickups (default engine.actor, plus net peers on a host)' },
  color: { type: 'any', default: DEFAULT_COLOR, desc: 'color of the placeholder box and geometry-only models when the pickup and its item set none' },
  size: { type: 'number', default: 0.25, min: 0, desc: 'edge of the placeholder box (meters)' },
  lift: { type: 'number', default: 0.4, desc: 'height above the ground a pickup floats at (meters)' },
};

/**
 * Pickups module: things on the ground that give whoever takes them an item (into that actor's container) or an instant effect. Installs engine.pickups and
 * the op pickup.take. Needs world() first; interactions() for the key prompt (auto: true pickups need none); inventory() only for give: itemId.
 * Options: radius (default reach, 2 m), showDistance (60 m), takers (who walks into auto pickups), color, size, lift (the placeholder's plain values); engine.pickups.material for the picture.
 * @example engine.use(openWorld(), interactions({ ...presets.interactions.nearest }), inventory(), pickups())
 * @example engine.use(world(), pickups({ radius: 1 }))   // coins and health packs only: auto pickups with give functions, no inventory, no prompt
 */
export function pickups(opts = {}) {
  const o = readParams('pickups', PICKUP_PARAMS, opts);
  let pk = null;
  return {
    name: 'pickups', type: 'rules', label: 'Pickups', params: PICKUP_PARAMS, options: o, requires: ['world'], optional: ['interactions', 'inventory', 'net'], stage: 'gameplay',
    noSkip: 'auto pickups are spatial; respawn follows the game clock',
    install(e, ctx) {
      pk = new Pickups(e, opts, ctx.track); defineTake(e, pk); return pk;
    },
    fixed() { pk._auto(); },
    describe(e, ctx) {   // use the model if present (same object the interactions module reports, merged into one entry); far away only data
      const w = e.world;
      for (const r of w.query({ kind: 'pickup', near: ctx.center, radius: ctx.radius, where: r => r.until == null })) ctx.near(w.view(r.id) ?? r.position, { name: pk._name(r), kind: 'pickup', id: r.item ?? r.id });
    },
  };
}
