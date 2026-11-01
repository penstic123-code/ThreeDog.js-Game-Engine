// World's contribution to thing.explain() (core/thingExplain.js): the record's fields as `state`, and the record's own collision / picking rules.
// Template rules come from the content module's explainer (content/explain.js), which runs after this and overrides these.

/** @internal Fill state and rules for a thing that has a world record */
export function worldExplain(e, t, out) {
  const rec = e.world?.get(t.id);
  if (!rec) return;
  out.state = { ...t.fields, position: t.position };
  Object.assign(out.rules, { blocksMovement: rec.collide ?? false, pickable: rec.static !== false, interact: null, note: RULES_NOTE });
}
export const RULES_NOTE = 'blocksMovement = the collision shape (box / circle) walkers stop at; blocking sight is not modelled by the engine';
