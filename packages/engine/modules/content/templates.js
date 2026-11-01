// Content templates (content/templates.js): one reusable object = model + collision + interaction + optional container / sound / animation + state defaults.
// The template is a shared, frozen definition; every placed copy is a world record whose kind is the template name and whose own fields are its state.
//   content/templates.js:
//     export default { chest: { model: 'chest', collide: 'box', state: { opened: false },
//       interact: { label: rec => rec.opened ? '关上' : '打开', op: 'chest.toggle' },          // op is run with { id } of the instance
//       container: { capacity: 6, items: { berry: 2 } }, sound: { use: 'chest' },               // container id = record id
//       animate: (rec, obj, dt) => { obj.rotation.x = rec.opened ? -0.3 : 0; } } };              // per-frame look from the record
//   content/props.js:  { template: 'chest', id: 'chest-home', place: 'home', x: 3, z: 1, opened: true, items: { film: 2 } }   // position + overrides
//   code (in an op or fixed step): engine.spawn('chest', { x: 10, z: 4 }, { opened: true })                         // runtime copy, saved whole
// Definition (shared, read-only): model, collide, static, interact, container capacity / starting goods, sound, animate, state defaults.
// Instance (saved): the record (id, kind, position, rot, scale, y offset, state fields) and the container with the record's id (its goods).
// A placement may override only rot / scale / y / items and the state fields; a different look or behaviour is a different template.
// Recipe: docs/recipes/30-templates.md.
// body: { shape: 'box' | 'ball' | 'hull', mass?, friction?, restitution?, damping?, angularDamping? } makes each copy a rigid body (needs rigid()):
//   it can be pushed, the model moves itself and its position is copied back to the record, so a pushed crate's place is saved like any other change.
// Ids: an instance with state (state / container / interact / body) should have a written id (ids.js); without one dev warns.
import { checkOptions, freezeDef, missingText, fmt, DEV } from '../../core/validate.js';
import { xzOf } from '../../core/math.js';
import { placeY } from '../../core/ground.js';
import { buildModel, settle, fitKey, unbuildModel } from './models.js';
import { srcOf, stateful, templateId } from './ids.js';

const DEF_KEYS = ['model', 'collide', 'static', 'interact', 'container', 'sound', 'animate', 'state', 'body'];
const BODY_KEYS = ['shape', 'mass', 'friction', 'restitution', 'damping', 'angularDamping'];
const OWN_KEYS = ['rot', 'scale', 'y', 'items'];   // what one instance may set besides its state fields

const STRINGS = {
  noModel: "template '{name}' needs a model (a style pack model name or an assets name), e.g. { model: 'chest' }",
  noOp: "template '{name}': interact needs op, the op run with { id } of the instance when used, e.g. interact: { label: '打开', op: 'chest.toggle' } "
    + "and in main.js engine.ops.define('chest.toggle', { run: (e, { id }) => e.world.set(id, { opened: !e.world.get(id).opened }) })",
  taken: "template '{name}': world kind '{name}' already has a world.present of its own; rename the template (its name is the kind of its instances)",
  clash: 'template instance id "{id}" is already used by other data (kind {kind}): give it a different id, e.g. { id: "{id}-2", template: "{name}" }',
  defKey: "template '{name}': '{key}' belongs to the definition and cannot be set per instance. Define another template for a different {key}",
  noBox: "template '{name}' has no container, so an instance cannot have items. Add container: { capacity } to the template",
  noInv: "template '{name}' has a container: install inventory() (the openWorld() preset includes it)",
  noRigid: "template '{name}' has a body: install rigid() (real physics; the openWorld() preset includes it)",
  shape: "template '{name}': body.shape must be 'box', 'ball' or 'hull', e.g. body: { shape: 'box', mass: 2 }",
};

/** Register template definitions (frozen) and their presenters; a later load replaces a definition of the same name. @internal */
export function defineTemplates(e, api, st, defs) {
  for (const [name, d] of Object.entries(defs)) {
    checkOptions(`template '${name}'`, d, DEF_KEYS);
    if (!d?.model) throw new Error(fmt(STRINGS.noModel, { name }));
    if (d.interact) {
      checkOptions(`template '${name}' interact`, d.interact, ['label', 'op', 'radius', 'height', 'action', 'enabled']);
      if (!d.interact.op) throw new Error(fmt(STRINGS.noOp, { name }));
      st.ops.add(d.interact.op);   // checked against engine.ops once the game is ready, like { op } in content
    }
    checkOptions(`template '${name}' container`, d.container, ['capacity', 'maxWeight', 'items']);
    checkOptions(`template '${name}' sound`, d.sound, ['use']);
    if (d.container && !e.inventory) throw new Error(fmt(STRINGS.noInv, { name }));
    if (d.body) {
      checkOptions(`template '${name}' body`, d.body, BODY_KEYS);
      if (!['box', 'ball', 'hull'].includes(d.body.shape)) throw new Error(fmt(STRINGS.shape, { name }));
      if (!e.rigid) throw new Error(fmt(STRINGS.noRigid, { name }));
    }
    st.templates.set(name, freezeDef(d));
    if (DEV) st.templateSrc.set(name, srcOf(defs, name));
    present(e, api, st, name);
    limitContainers(e, st, name);
  }
  // a save brings back runtime instances and their goods, but container limits are definition data: put them back from the template
  st.templateLoad ??= e.events.on('world:load', () => { for (const name of st.templates.keys()) limitContainers(e, st, name); });
}

/** The definition of a template, or a dev error listing the known ones. @internal */
export function templateOf(st, name) {
  const d = st.templates.get(name);
  if (!d) throw new Error(`${missingText('template', name, [...st.templates.keys()])} (define it in content/templates.js)`);
  return d;
}

/**
 * One entry of content/props.js with template: an initial world record (stable id `<template>:<index>` unless given). @internal
 * ids: this load's IdCheck (null for level nodes, whose ids the level makes); origin: where it was authored ({ definedAt } or { level, node }), dev only
 */
export function placeTemplate(e, api, st, p, i, zone, ids, origin) {
  const name = p.template, d = templateOf(st, name), id = templateId(p, i), { x, y, z } = api.where(p), floor = api._floorOf(p);
  const own = instanceFields(name, d, p, ['template', 'id', 'place', 'x', 'z', 'floor']);
  if (floor !== undefined) own.floor = floor;   // same as props: a moved instance lands on the same storey
  if (ids && p.id != null) ids.claim(p.id, `props[${i}] (template ${name})`);
  else if (ids && stateful(d)) ids.unnamed(id, `props[${i}] (template ${name})`);
  const rec = e.world.add({ id, kind: name, position: { x, y: y ?? placeY(e, `props[${i}] (template ${name})`, x, z), z }, ...own, ...(zone != null && { zone }) }, { initial: true });
  if (rec && rec.kind !== name) throw new Error(fmt(STRINGS.clash, { id, kind: rec.kind, name }));
  if (DEV) e.world.setOrigin(id, { ...(typeof origin === 'string' ? { definedAt: origin } : origin), template: name, templateAt: st.templateSrc.get(name) ?? null, model: d.model });
  if (rec) openContainer(e, name, d, id, p.items);   // null = removed in the save: no container either
}

/** engine.spawn: a runtime instance (saved whole). at = position ({ x, z } or [x, y, z]; it sits on the ground, fields.y lifts it). @internal */
export function spawnTemplate(e, st, name, at, fields = {}) {
  const d = templateOf(st, name), [x, z] = xzOf(at);
  const own = instanceFields(name, d, fields, ['id']);
  const rec = e.world.add({ ...(fields.id != null && { id: fields.id }), kind: name, position: { x, y: placeY(e, `engine.spawn('${name}')`, x, z, undefined, 0) + (fields.y ?? 0), z }, ...own });
  if (DEV) e.world.setOrigin(rec.id, { template: name, templateAt: st.templateSrc.get(name) ?? null, model: d.model });   // world.add already noted the op that spawned it
  openContainer(e, name, d, rec.id, fields.items);
  return rec;
}

/** Instance fields of a placement: state defaults (copied, never shared), then the allowed overrides. */
function instanceFields(name, d, p, also) {
  const state = Object.keys(d.state ?? {});
  for (const key of Object.keys(p)) if (DEF_KEYS.includes(key) && !state.includes(key)) throw new Error(fmt(STRINGS.defKey, { name, key }));
  checkOptions(`template '${name}' instance`, p, [...also, ...OWN_KEYS, ...state]);
  if (p.items && !d.container) throw new Error(fmt(STRINGS.noBox, { name }));
  const own = structuredClone(d.state ?? {});
  for (const k of state) if (p[k] !== undefined) own[k] = structuredClone(p[k]);
  for (const k of ['rot', 'scale']) if (p[k] !== undefined) own[k] = p[k];
  if (p.y) own.offsetY = p.y;
  return own;
}

/** The instance's container (id = record id); starting goods only the first time, a save wins afterwards (see Containers). */
function openContainer(e, name, d, id, items) {
  if (!d.container) return;
  const { capacity, maxWeight } = d.container;
  e.inventory.container(id, { capacity, maxWeight, items: items ?? d.container.items });
}

function limitContainers(e, st, name) {
  const c = st.templates.get(name).container;
  if (c) for (const r of e.world.query({ kind: name })) e.inventory.container(r.id, { capacity: c.capacity, maxWeight: c.maxWeight });
}

/** How a template's instances look: shared prototype model, collision, interaction; built near, torn down far (once per template name). */
function present(e, api, st, name) {
  if (st.templateViews.has(name)) return;
  if (e.world.presents(name)) throw new Error(fmt(STRINGS.taken, { name }));
  st.templateViews.add(name);
  const def = () => st.templates.get(name);   // a later load may replace the definition: always read the current one
  const body = !!def().body;   // a physics body moves the model itself: the record follows the model (positionFrom 'view'), so a pushed position is saved
  e.world.present(name, {
    radius: () => Math.max(e.world.radius, e.stream.activeRadius),   // same build distance as props
    positionFrom: body ? 'view' : 'record',
    async build(rec) {
      const d = def(), o = await buildModel(e, api, rec, d.model, d.body ? { ...d, static: false, collide: false } : d), id = rec.id;
      if (d.body) addBody(e, rec, o, d.body);
      if (d.interact && e.interactions) o.userData.use = e.interactions.add(o, {
        id, radius: d.interact.radius ?? 2.5, height: d.interact.height, action: d.interact.action,
        label: () => label(e, def().interact?.label, e.world.get(id)) ?? name,
        enabled: () => { const r = e.world.get(id), en = def().interact?.enabled; return !!r && (!en || !!en(r, e)); },
        onUse: () => use(e, def(), id),
      });
      return o;
    },
    update(rec, o, dt) {
      const d = def();
      if (!d.body && o.userData.fit !== fitKey(rec)) settle(e, rec, o, d);   // a body places itself
      else if (d.body) restBody(e, rec, o);
      d.animate?.(rec, o, dt);
    },
    dispose(rec, o) { o.userData.use?.remove(); o.userData.body?.remove(); unbuildModel(e, o); },
  });
}

/**
 * A rigid body for one built copy, never batched (it moves). It rests on the ground at the record's place: the collider is centred on the model's origin,
 * so the copy is lifted by half its height, and that resting place counts as the authored one (world.rest), so an untouched crate stays out of the save.
 * The body starts asleep: it stays exactly there until something hits it; then its moves are copied to the record (positionFrom 'view') and saved.
 */
function addBody(e, rec, o, b) {
  const { shape, ...opts } = b, s = o.userData.proto.size, scale = rec.scale ?? 1;
  o.userData.batch = false;
  const ground = e.surface(rec.position.x, rec.position.z, rec.floor), y = Math.max(rec.position.y, ground + s.y * scale / 2);
  e.world.rest(rec.id, { x: rec.position.x, y, z: rec.position.z });
  o.position.y = rec.position.y;
  o.updateMatrixWorld(true);
  const add = shape === 'ball' ? 'addBall' : shape === 'hull' && o.isMesh ? 'addHull' : 'addBox';   // a hull needs one mesh; a group gets a box
  o.userData.body = e.rigid[add](o, opts);
  o.userData.body?.body.sleep();
}
const SETTLE = 0.05;   // meters: a body that only settled (contact with uneven ground) moves less than this; a push moves it more
/** While an authored body only settles where content put it, that settled pose is its authored rest (it stays out of the save); once pushed, the record keeps the change */
function restBody(e, rec, o) {
  const ud = o.userData, b = ud.body?.body;
  if (ud.pushed || !b) return;
  ud.restAt ??= { ...rec.position };
  const p = rec.position, r = ud.restAt;
  if (Math.abs(p.x - r.x) > SETTLE || Math.abs(p.y - r.y) > SETTLE || Math.abs(p.z - r.z) > SETTLE) { ud.pushed = true; return; }
  if (b.isSleeping()) e.world.rest(rec.id, p, SETTLE);
}

const label = (e, l, rec) => typeof l === 'function' ? l(rec, e) : l && e.i18n.has(l) ? e.t(l) : l;

/** Using an instance runs the template's op with its id (a gameplay action, logged), then plays the use sound if it succeeded. */
function use(e, d, id) {
  const r = e.ops.run(d.interact.op, { id });
  if (r.ok && d.sound?.use) e.audio.sfx(d.sound.use);
}
