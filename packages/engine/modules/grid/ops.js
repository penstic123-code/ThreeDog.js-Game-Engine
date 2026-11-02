// grid.place / grid.remove / grid.move: placing on a grid is a player (or NPC) decision, so it is an op.
// can() is exactly Grid.can, so a button can grey out, the preview can turn red and the dev bridge can list reasons from one rule.
// A placed thing is one world record: { kind, position (footprint center), rot (yaw, for presenters), grid: { id, cell, size, rotation, item } }.
// Occupancy is derived from rec.grid by the index in index.js; nothing else stores it. A named item's occupancy layer comes from its rule (grids._ruleOf).
const REASONS = {
  noGrid: 'No grid with that name (engine.grids.add)',
  outOfBounds: 'Part of the footprint is outside the grid',
  occupied: 'A cell is already taken (grid.at(cell) says by what)',
  wrongGround: 'Ground type (engine.groundType) is not one the item allows',
  notFlat: 'Ground under the footprint is too uneven',
  unknown: 'No world record with that id',
  notPlaced: 'That record is not on a grid',
};

/** Record fields the placement owns: fields passed to grid.place may not set them */
const RESERVED = ['id', 'kind', 'grid', 'position', 'rot'];

/** The placed-record fields for a footprint; level is written only when not 0, so older saves read the same. size and occupy are written only for a
 *  record without an item name (inline rule): a named item's size and layer are read from its rule (grids._ruleOf), never copied, so new content and old saves agree @internal */
export function placed(g, rule, item, cell, rotation, level = 0) {
  return {
    position: g.toWorld(cell, rule.size, rotation, level), rot: rotation * Math.PI / 2,
    grid: { id: g.name, cell: [cell[0], cell[1]], rotation, ...(item ? { item } : { size: [rule.size[0], rule.size[1]] }),
      ...(!item && rule.occupy && rule.occupy !== 'main' ? { occupy: rule.occupy } : {}), ...(level ? { level } : {}) },
  };
}

/** Define the grid ops (once per install) @internal */
export function defineGridOps(e, grids) {
  const handles = [
    e.ops.define('grid.place', {
      desc: 'Place an item on a grid: creates a world record whose footprint occupies cells in the item\'s occupancy layer. item = name from engine.grids.define; rotation = quarter turns; level = storey (default 0)',
      args: { grid: 'string', item: 'string', cell: 'any', rotation: 'int?', level: 'int?', fields: 'any?', id: 'string?' },
      can(e, { grid, item, cell, rotation = 0, level = 0, id, fields }) {
        const g = grids.get(grid);
        if (fields && RESERVED.some(k => k in fields)) return 'badFields';
        if (!g) return 'noGrid';
        if (id && e.world.get(id)) return 'idTaken';
        return g.can(item, cell, { rotation, level });
      },
      run(e, { grid, item, cell, rotation = 0, level = 0, fields, id }) {
        const g = grids._must(grid), rule = grids._rule(item);
        const rec = e.world.add({ ...(id ? { id } : {}), kind: rule.kind ?? item, ...structuredClone(rule.fields ?? {}), ...fields, ...placed(g, rule, item, cell, rotation, level) });
        return rec.id;
      },
      reasons: { ...REASONS, idTaken: 'A world record with that id exists', badFields: 'fields may not set id / kind / grid / position / rot: the placement owns them (pass id as its own argument)' },
    }),
    e.ops.define('grid.remove', {
      desc: 'Pick up a placed thing: removes its world record and frees its cells',
      args: { id: 'string' },
      can(e, { id }) { const r = e.world.get(id); return !r ? 'unknown' : !r.grid ? 'notPlaced' : true; },
      run(e, { id }) { const r = e.world.get(id), out = { item: r.grid.item ?? r.kind, kind: r.kind }; e.world.remove(id); return out; },
      reasons: REASONS,
    }),
    e.ops.define('grid.move', {
      desc: 'Move / turn a placed thing to another cell (or another grid / level); its own cells do not block it',
      args: { id: 'string', cell: 'any', rotation: 'int?', grid: 'string?', level: 'int?' },
      can(e, { id, cell, rotation, grid, level }) {
        const r = e.world.get(id);
        if (!r) return 'unknown';
        if (!r.grid) return 'notPlaced';
        const g = grids.get(grid ?? r.grid.id);
        if (!g) return 'noGrid';
        return g.can(grids._ruleOf(r.grid), cell, { rotation: rotation ?? r.grid.rotation, ignore: id, level: level ?? r.grid.level ?? 0 });
      },
      run(e, { id, cell, rotation, grid, level }) {
        const r = e.world.get(id), g = grids._must(grid ?? r.grid.id), rule = grids._ruleOf(r.grid);
        e.world.set(id, placed(g, rule, r.grid.item, cell, rotation ?? r.grid.rotation, level ?? r.grid.level ?? 0));
        return id;
      },
      reasons: REASONS,
    }),
  ];
  return () => { for (const h of handles) h.remove(); };
}
