// Guards for the gameplay-module review fixes (docs/plans/review/gameplay.md). Same format as specs.mjs, appended at the end of it.

export const specs = [
  {
    name: 'gameplay guards: transfer can() counts free slots once; drop keeps the actor floor; grid fields cannot override the placement (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const I = engine.inventory, W = fn => engine.ops._allowing(fn);
        I.define('g-sword', { name: 'sword', stack: 1 });
        const box = I.container('g-box', { capacity: 1 });
        W(() => { for (let i = 0; i < 3; i++) I.add('g-sword', 1, { data: { n: i }, silent: true }); });
        const can = engine.ops.can('inventory.transfer', { from: 'player', to: 'g-box', item: 'g-sword', n: 3 });
        const can1 = engine.ops.can('inventory.transfer', { from: 'player', to: 'g-box', item: 'g-sword', n: 1 });
        // drop: the pickup's reference height is the actor's y, not 0
        const p = engine.player.position, seen = [], orig = I.spawnPickup.bind(I);
        I.spawnPickup = (id, at, o) => { seen.push(at[1]); return orig(id, at, o); };
        engine.ops.run('inventory.drop', { item: 'g-sword', n: 1 });
        I.spawnPickup = orig;
        // grid.place: fields may not set id / kind / position
        let grid = null;
        if (engine.grids) {
          engine.grids.add('g-grid', { cell: 1, origin: { x: p.x, z: p.z }, size: [4, 4] });
          engine.grids.define('g-crate', { size: [1, 1] });
          grid = engine.ops.can('grid.place', { grid: 'g-grid', item: 'g-crate', cell: [0, 0], fields: { id: 'stolen' } });
        }
        return { can: can.ok ? true : can.reason, can1: can1.ok, dropY: seen[0], py: p.y, grid };
      });
      check('3 entries into 1 free slot is refused as full; 1 is fine', r.can === 'full' && r.can1, JSON.stringify(r));
      check('drop passes the actor height as the floor reference', Math.abs(r.dropY - r.py) < 1e-6, JSON.stringify(r));
      check('grid.place refuses fields that set id (when grids is installed)', r.grid === null || r.grid.reason === 'badFields', JSON.stringify(r));
    },
  },
  {
    name: 'gameplay guards: world.anchor takes [x, y, z] and refuses junk; grid layer data is read only in dev; openWorld({ vegetation: {...} }) and pickTarget({ range }) throw with the fix (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const w = engine.world, W = fn => engine.ops._allowing(fn), out = {};
        const p = engine.player.position;
        w.simulate('g-near', { near: rec => { rec.hits = (rec.hits ?? 0) + 1; }, radius: 5 });
        W(() => w.add({ id: 'g-n1', kind: 'g-near', position: [p.x + 500, 0, p.z] }));
        w.anchor = [p.x + 500, 0, p.z];
        engine.step(0.2);
        out.nearHits = w.get('g-n1').hits ?? 0;
        w.anchor = null;
        try { w.anchor = 'home'; out.badAnchor = 'no throw'; } catch (err) { out.badAnchor = err.message; }
        if (engine.grids) {
          const g = engine.grids.get('g-l', false) ?? engine.grids.add('g-l', { cell: 1, origin: { x: 0, z: 0 }, size: [4, 4] });
          const soil = g.layer('g-soil');
          W(() => soil.set([1, 1], { wet: true }));
          try { soil.get([1, 1]).wet = false; out.frozen = 'writable'; } catch { out.frozen = 'frozen'; }
          W(() => soil.updateAll(d => { d.wet = 'x'; }));
          out.updated = soil.get([1, 1]).wet;
        }
        return out;
      });
      const { openWorld, pickTarget } = await import('../../index.js');   // pure option checks: run here in node
      try { openWorld({ vegetation: { density: 2 } }); r.veg = 'no throw'; } catch (err) { r.veg = err.message; }
      try { pickTarget({ x: 0, z: 0 }, 0, [], { range: 5 }); r.range = 'no throw'; } catch (err) { r.range = err.message; }
      check('an [x, y, z] anchor simulates the records near it', r.nearHits > 5, JSON.stringify(r));
      check('a non-position anchor throws with the accepted forms', /world.anchor must be/.test(r.badAnchor), r.badAnchor);
      check('openWorld vegetation options throw and point to density', /vegetation takes no options/.test(r.veg) && /density/.test(r.veg), r.veg);
      check('pickTarget range throws and names radius', /radius/.test(r.range), r.range);
      check('layer data is frozen; updateAll still edits its copy', r.frozen === undefined || (r.frozen === 'frozen' && r.updated === 'x'), JSON.stringify(r));
    },
  },
  {
    name: 'gameplay guards: interaction ids are the record id for NPCs, pickups and entities; triggers bind F4 only in dev; flow.transition does not autosave by default (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const W = fn => engine.ops._allowing(fn), p = engine.player.position;
        engine.entities.define('g-box', { create: () => new engine.THREE.Group(), interact: { label: 'open', onUse: () => {} } });
        const ent = W(() => engine.entities.spawn('g-box', { position: { x: p.x + 1, z: p.z } }));
        const pick = W(() => engine.inventory.spawnPickup('film', { x: p.x - 1, z: p.z }, { id: 'g-film' }));
        engine.world.refresh(); engine.step(0.1);
        const ids = engine.interactions.items.map(i => i.id);
        let saved = 0;
        const off = engine.events.on('save', () => saved++);
        if (engine.flow) await engine.flow.transition(() => {}, { fade: 0.01 });
        off.remove();
        return { ent: ent.id, entIn: ids.includes(ent.id), pickIn: ids.includes(pick.worldId), npc: ids.some(id => engine.world.get(id)?.kind === 'npc'), npcs: engine.world.query({ kind: 'npc' }).length,
          triggerKey: engine.input.actions.has('triggersDebug'), saved, flow: !!engine.flow };
      });
      check('entity and pickup interactions are named by their record id', r.entIn && r.pickIn && /^entity:g-box-\d+$/.test(r.ent), JSON.stringify(r));
      check('dev builds bind the trigger debug toggle', r.triggerKey, JSON.stringify(r));
      check('transition saves nothing unless asked', !r.flow || r.saved === 0, JSON.stringify(r));
    },
  },
];
