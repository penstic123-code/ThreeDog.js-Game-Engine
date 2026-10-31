// Props (each item of content/props.js): data is a plain record in engine.world with kind 'prop'; model and collision are "presentation that exists only when near".
//   record: { id, kind: 'prop', position: {x,y,z}, model, rot?, scale?, collide?, offsetY?, static?, batch?, zone? } (plain values only)
//   Initial world data (initial: true on add): the save records only moves / removals, independent of content.load running before or after loading a save; positions using level markers carry a zone (data is kept across level changes).
//   id: the written id if content gives one; otherwise `prop:<model name>:<index in this props array>` (same on every load of the same content, no collisions).
//       To insert new entries in the middle later, give existing ones an id; otherwise later indexes shift and no longer match moves / removals in old saves.
//   move / remove: engine.world.move(id, { x, z }) / engine.world.remove(id), included in the save automatically; height y is computed from the ground both on add and when the model is built, so ignore it.
//   models: one prototype per model name (same-name props share geometry and material), each placement clones it; built when near (within view distance), torn down when far, only detached while keeping the prototype.
//   collision: built / torn down with the model (only things near the player need to block), so props beyond the collision radius take no space in the collision table.
//   An entry with template (instead of model) is an instance of a content template: see templates.js.
import { buildModel, settle, fitKey, unbuildModel } from './models.js';
import { placeTemplate } from './templates.js';

const list = v => (Array.isArray(v) ? v : [v]);

/** Stable id of a prop: the written id if given, otherwise "model name + array index" */
const propId = (p, i) => p.id ?? `prop:${list(p.model)[0]}:${i}`;

/** Add the props array as initial world data (existing same-id records are kept, ones removed in the save are not re-added). zoneOf(p) gives the level an item belongs to (null = everywhere) */
export function addProps(e, api, props, models, st, zoneOf) {
  const world = needWorld(e);
  presentProps(e, api, world, st, models);
  props.forEach((p, i) => {
    if (p.template) return placeTemplate(e, api, st, p, i, zoneOf(p));   // an instance of a content template (templates.js), not a plain prop
    const id = propId(p, i), { x, y, z } = api.where(p), zone = zoneOf(p), floor = api._floorOf(p);
    // compute y from the ground now (same as when the model is built): unmoved props equal the content and stay out of the save
    const def = { id, kind: 'prop', position: { x, y: y ?? e.surface(x, z), z }, model: p.model };
    for (const k of ['rot', 'scale', 'collide', 'static', 'batch']) if (p[k] !== undefined) def[k] = p[k];
    if (p.y) def.offsetY = p.y;
    if (floor !== undefined) def.floor = floor;   // kept so a moved prop lands on the same storey
    if (zone != null) def.zone = zone;
    const rec = world.add(def, { initial: true });
    if (rec && (rec.kind !== 'prop' || JSON.stringify(rec.model) !== JSON.stringify(p.model))) throw new Error(`Prop id "${id}" is already used by other data (${rec.kind}${rec.model ? ' ' + JSON.stringify(rec.model) : ''}): give this item a different id, e.g. { id: '${id}-2', model: ... }`);
  });
}

/** Dev error when the world module is not installed */
export function needWorld(e) {
  if (!e.world) throw new Error('content has props or pickups, whose data is stored in world: call engine.use(world()) first (the openWorld() preset already installs it)');
  return e.world;
}

/** Register how props are displayed (once per content) */
function presentProps(e, api, world, st, models) {
  st.models = { ...st.models, ...models };   // models tables of repeated loads are merged; the presenter looks up by name
  if (st.propsPresenter) return;

  st.propsPresenter = world.present('prop', {
    radius: () => Math.max(world.radius, e.stream.activeRange),   // build by view distance: follows the terrain view distance (fog distance if no terrain), also when changed at runtime
    build: rec => buildModel(e, api, rec, rec.model, st.models, rec),   // a failed model generation is reported by world (does not block loading), retried when near again
    // moved / rot or scale changed (world.move sends no event, so compare here): world already put the model at the new position; collision and rays follow
    update(rec, o) { if (o.userData.fit !== fitKey(rec)) settle(e, rec, o, rec); },
    dispose: (rec, o) => unbuildModel(e, o),
  });
}
