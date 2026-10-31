// Building an entity's model side (helper of Entities.js): the empty root that carries rotation and interactions, its model, interaction and collider.
// `m` is the Entities instance.

export function buildEntity(m, ent) {
  const e = m.engine, def = ent.def, rec = m.world.get(ent.id), root = new e.THREE.Group();
  rec.position.y ??= e.surface(rec.position.x, rec.position.z);   // initial world records may omit y (snap to ground); computed when the model is first built
  root.position.set(rec.position.x, rec.position.y, rec.position.z);
  root.rotation.y = rec.rotation;
  root.userData.entity = ent.id;
  root.userData.budgetTag = 'entities';
  ent._root = root; ent.visual = null; ent._modelStage = -1; ent._shownStage = -1;
  m._setVisual(ent, def.create(e, ent));
  m._refresh(ent);
  if (def.interact && e.interactions) {
    const it = def.interact;
    ent._handles.push(e.interactions.add(root, {
      id: ent.id,   // the interaction.use op names it the same in every run (an async create would otherwise get a load-order number)
      label: () => m._label(it.label, ent), radius: it.radius ?? 2.5, action: it.action, height: it.height,
      enabled: () => !!m.world.get(ent.id) && (it.enabled ? it.enabled(ent, e) : true),
      onUse: () => it.onUse?.(ent, e),
    }));
  }
  if (def.collider && e.collision) ent._handles.push(e.collision.addCircle({ x: rec.position.x, z: rec.position.z }, { radius: def.collider, height: def.colliderHeight ?? 3 }));
  return root;
}
