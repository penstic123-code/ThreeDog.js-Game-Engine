// world() module: installed as engine.world (world data, see World.js). Models load around engine.stream sources; records stay when models unload. Independent of game type: slow-life NPCs, shooter enemies, survival zombies and containers all use it.
//   engine.use(world())                     // the openWorld() preset installs it by default
//   engine.use(world({ radius: 80 }))       // distance (meters) for building models and counting as near, default 60
// Save key world (runtime records whole, initial records only changes and removals, see the top of World.js); emits world:load after loading. The loading screen waits for world.ready (nearby models all built). describe() reports world.total / byKind / presented, and nearby records with a name go into nearby.
import { World } from './World.js';
import { WORLD_MIGRATE } from './persist.js';
import { checkOptions, closest, warnOnce, DEV } from '../../core/validate.js';

const ORPHAN = '[world] the save has changes for {n} id(s) that the content no longer defines: {list}. They are kept in the save (restoring the entry brings them back); '
  + 'if an entry was renamed, give it its old id again, or keep the new one and accept that its saved state starts over';

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
      e.stream.player.at(() => w.center);   // the default stream source sits where gameplay is simulated (world.anchor, else the player)
      e.stream.readyCheck('world', s => s.detail !== 'full' || w.ready);
      e.saves.register('world', { version: 2, migrate: WORLD_MIGRATE, save: () => w.toJSON(), load: d => w.fromJSON(d) });
      e.budget.metric('worldRecords', () => w.records.size);
      if (DEV) {   // orphans are known once content loaded (engine:ready), after a load, and per level for `<level>/<node>` ids
        const warn = () => {
          const o = w.orphans(); if (!o.length) return;
          const ids = [...w._base.keys()], list = o.slice(0, 8).map(id => { const c = closest(id, ids); return c ? `${id} (did you mean ${c}?)` : id; });
          warnOnce(ORPHAN.replace('{n}', String(o.length)).replace('{list}', list.join(', ') + (o.length > 8 ? ', …' : '')));
        };
        for (const ev of ['engine:ready', 'save:loaded', 'level:loaded']) e.events.on(ev, () => { if (e.ready) warn(); });
      }
      return w;
    },
    isReady() { return w.ready; },
    afterLoad(e) { if (e.paused) w.refresh(); return w.whenReady; },   // a paused engine has no frames to build in: build now
    counts() { let views = 0; for (const id of w.records.keys()) if (w.view(id)) views++; return { records: w.records.size, views }; },   // engine.counts().world
    fixed(dt) { w.fixed(dt); },
    skip(dt, e, done) { w._s.skip(dt, done); },
    frame(dt) { w.frame(dt); },
    describe(e, ctx) {
      const byKind = {};
      for (const r of w.records.values()) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      // with a model, report by the model (merged with the interaction and other modules' reports on the same object into one entry); skip records of another zone (level)
      for (const r of w.query({ near: ctx.center, radius: ctx.radius })) if (r.name != null && w._inZone(r)) ctx.near(w.view(r.id) ?? r.position, { id: r.id, name: r.name, kind: r.kind }, true);
      const orphans = w.orphans();
      return { total: w.records.size, byKind, presented: w._v.map.size, zone: w.zone, ...(orphans.length && { orphans: orphans.slice(0, 20) }) };
    },
    dispose() { w.dispose(); },
  };
}
