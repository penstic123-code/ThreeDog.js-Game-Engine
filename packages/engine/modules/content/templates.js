// Content templates (content/templates.js): one reusable object = model + collision + interaction + optional container / sound / animation + state defaults.
// The template is a shared, frozen definition; every placed copy is a world record whose kind is the template name and whose own fields are its state.
//   content/templates.js:
//     export default { chest: { model: 'chest', collide: 'box', state: { opened: false },
//       interact: { label: rec => rec.opened ? '关上' : '打开', op: 'chest.toggle' },          // op is run with { id } of the instance
//       container: { capacity: 6, items: { berry: 2 } }, sound: { use: 'chest' },               // container id = record id
//       animate: (rec, obj, dt) => { obj.rotation.x = rec.opened ? -0.3 : 0; } } };              // per-frame look from the record
//   content/props.js:  { template: 'chest', id: 'chest-home', place: 'home', x: 3, z: 1, opened: true, items: { film: 2 } }   // position + overrides
//   code (in an op or fixed step): engine.content.spawn('chest', { x: 10, z: 4 }, { opened: true })                         // runtime copy, saved whole
// Definition (shared, read-only): model, collide, static, interact, container capacity / starting goods, sound, animate, state defaults.
// Instance (saved): the record (id, kind, position, rot, scale, y offset, state fields) and the container with the record's id (its goods).
// A placement may override only rot / scale / y / items and the state fields; a different look or behaviour is a different template.
// Recipe: docs/recipes/30-templates.md.
import { checkOptions, freezeDef, missingText } from '../../core/validate.js';
import { xzOf } from '../../core/math.js';
import { buildModel, settle, fitKey, unbuildModel } from './models.js';

const DEF_KEYS = ['model', 'collide', 'static', 'interact', 'container', 'sound', 'animate', 'state'];
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
};
const fmt = (s, p) => s.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m);

/** Register template definitions (frozen) and their presenters; a later load replaces a definition of the same name. @internal */
export function defineTemplates(e, api, st, defs, models) {
  st.models = { ...st.models, ...models };
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
    st.templates.set(name, freezeDef(d));
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

/** One entry of content/props.js with template: an initial world record (stable id `<template>:<index>` unless given). @internal */
export function placeTemplate(e, api, st, p, i, zone) {
  const name = p.template, d = templateOf(st, name), id = p.id ?? `${name}:${i}`, { x, y, z } = api.where(p), floor = api._floorOf(p);
  const own = instanceFields(name, d, p, ['template', 'id', 'place', 'x', 'z', 'floor']);
  if (floor !== undefined) own.floor = floor;   // same as props: a moved instance lands on the same storey
  const rec = e.world.add({ id, kind: name, position: { x, y: y ?? e.surface(x, z), z }, ...own, ...(zone != null && { zone }) }, { initial: true });
  if (rec && rec.kind !== name) throw new Error(fmt(STRINGS.clash, { id, kind: rec.kind, name }));
  if (rec) openContainer(e, name, d, id, p.items);   // null = removed in the save: no container either
}

/** engine.content.spawn: a runtime instance (saved whole). at = position ({ x, z } or [x, y, z]; it sits on the ground, fields.y lifts it). @internal */
export function spawnTemplate(e, st, name, at, fields = {}) {
  const d = templateOf(st, name), [x, z] = xzOf(at);
  const own = instanceFields(name, d, fields, ['id']);
  const rec = e.world.add({ ...(fields.id != null && { id: fields.id }), kind: name, position: { x, y: e.surface(x, z) + (fields.y ?? 0), z }, ...own });
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
  e.world.present(name, {
    radius: () => Math.max(e.world.radius, e.stream.activeRange),   // same build distance as props
    async build(rec) {
      const d = def(), o = await buildModel(e, api, rec, d.model, st.models, d), id = rec.id;
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
      if (o.userData.fit !== fitKey(rec)) settle(e, rec, o, d);
      d.animate?.(rec, o, dt);
    },
    dispose(rec, o) { o.userData.use?.remove(); unbuildModel(e, o); },
  });
}

const label = (e, l, rec) => typeof l === 'function' ? l(rec, e) : l && e.i18n.has(l) ? e.t(l) : l;

/** Using an instance runs the template's op with its id (a gameplay action, logged), then plays the use sound if it succeeded. */
function use(e, d, id) {
  const r = e.ops.run(d.interact.op, { id });
  if (r.ok && d.sound?.use) e.audio.sfx(d.sound.use);
}
