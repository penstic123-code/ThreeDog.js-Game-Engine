// world() module: installed as engine.world (world data, see World.js). Models load around engine.load sources; records stay when models unload. Independent of game type: slow-life NPCs, shooter enemies, survival zombies and containers all use it.
//   engine.use(world())                     // the openWorld() preset installs it by default
//   engine.use(world({ radius: 80 }))       // distance (meters) for building models and counting as near, default 60
// Save key world (runtime records whole, initial records only changes and removals, see the top of World.js); emits world:load after loading. The loading screen waits for world.ready (nearby models all built). describe() reports world.total / byKind / presented, and nearby records with a name go into nearby.
import { World } from './World.js';
import { WORLD_MIGRATE } from './persist.js';
import { checkOptions } from '../../core/validate.js';

/**
 * World data module: installed as engine.world. Put things here that must be saved, survive level changes and keep changing while far away; models are only built while nearby
 * @example engine.use(world())
 * @param {{ cellSize?: number, radius?: number, farEvery?: number, farMaxPerTick?: number, buildPerFrame?: number }} [opts]
 * @returns {import('../../types/core').ModuleDef<World>}
 */
export function world(opts = {}) {
  checkOptions('world()', opts, ['cellSize', 'radius', 'farEvery', 'farMaxPerTick', 'buildPerFrame']);
  let w = null;
  return {
    name: 'world', label: 'World data', stage: 'world',
    install(e) {
      w = new World(e, opts);
      e.load.player.at(() => w.center);   // the default load source sits where gameplay is simulated (world.anchor, else the player)
      e.load.readyCheck('world', s => s.detail !== 'full' || w.ready);
      e.saves.register('world', { version: 2, migrate: WORLD_MIGRATE, save: () => w.toJSON(), load: d => w.fromJSON(d) });
      e.budget.metric('worldRecords', () => w.records.size);
      return w;
    },
    isReady() { return w.ready; },
    counts() { let views = 0; for (const id of w.records.keys()) if (w.view(id)) views++; return { records: w.records.size, views }; },   // engine.counts().world
    fixed(dt) { w.fixed(dt); },
    skip(dt, e, done) { w._s.skip(dt, done); },
    frame(dt) { w.frame(dt); },
    describe(e, ctx) {
      const byKind = {};
      for (const r of w.records.values()) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      // with a model, report by the model (merged with the interaction and other modules' reports on the same object into one entry); skip records of another zone (level)
      for (const r of w.query({ near: ctx.center, radius: ctx.radius })) if (r.name != null && w._inZone(r)) ctx.near(w.view(r.id) ?? r.position, { id: r.id, name: r.name, kind: r.kind }, true);
      return { total: w.records.size, byKind, presented: w._v.map.size, zone: w.zone };
    },
    dispose() { w.dispose(); },
  };
}
