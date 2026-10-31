// Stage 1.11, world data separate from presentation: tests for entities (modules/entities) after moving to engine.world; same style as s1-world.mjs, appended at the end of specs.mjs.
export const specs = [
  {
    name: 'S1 entities: spawn with stage but no stageAt counts from now and grows as usual (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        engine.entities.define('s1stg', { create: e => new e.THREE.Mesh(new e.THREE.BoxGeometry(1, 1, 1), new e.THREE.MeshBasicMaterial()), stages: [{ name: 'a', duration: 5 }, { name: 'b', duration: 5 }, { name: 'c' }] });
        const ent = engine.entities.spawn('s1stg', { state: { stage: 1 } });
        const at = ent.state.stageAt;
        engine.step(6);
        return { at, now: engine.clock.now, stage: ent.state.stage };
      });
      check('stageAt is a finite number; reaches the last stage after 6 seconds', Number.isFinite(r.at) && r.stage === 2, JSON.stringify(r));
    },
  },
  {
    name: 'S1 entities: data lives in world; walking away tears down model / interaction / collision, it keeps growing while far, and walking back rebuilds for the new stage (open world)',
    url: '/?cutscene=skip',   // the opening cutscene takes over the camera (focus would not follow the player)
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const T = engine.THREE, P = engine.player, home = P.position.clone(), W = engine.world;
        const box = c => new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: c }));
        let disposed = 0, interactAdds = 0, interactRemoves = 0;
        const origAdd = engine.interactions.add.bind(engine.interactions);
        engine.interactions.add = (obj, ...a) => {   // count only this entity's (nearby pickups also attach interactions)
          const h = origAdd(obj, ...a);
          if (obj?.userData?.entity !== 's1-sap') return h;
          interactAdds++; return { ...h, remove: () => { interactRemoves++; return h.remove(); } };
        };
        engine.entities.define('s1grow', {
          create: () => box(0x00ff00),
          stages: [{ name: 'seed', duration: 20, scale: 0.2 }, { name: 'sapling', duration: 20, scale: 0.5 }, { name: 'tree', model: () => box(0xff0000), scale: 2 }],
          interact: { label: '浇水', onUse: ent => ent.set('watered', true) },
          collider: 0.4,
          dispose: () => { disposed++; },
        });
        const ent = engine.entities.spawn('s1grow', { id: 's1-sap', position: { x: home.x + 5, z: home.z }, extra: { owner: 'me' } });
        engine.step(0.3);
        const rec = W.get('s1-sap');
        const near = { kind: rec.kind, hasRoot: !!ent.object?.parent, stageName: ent.stageName, scale: ent.visual?.scale.x,
          sameData: ent.state === rec.state && ent.data.owner === 'me' && ent.x === rec.position.x, interactAdds };
        P.placeAt({ x: home.x + 400, z: home.z }); engine.step(3);   // camera focus smooths over to the new spot
        const away = { object: ent.object, visual: ent.visual, viewGone: W.view('s1-sap') === null, stage: ent.state.stage, still: !!engine.entities.get('s1-sap'), disposed, interactRemoves };
        const events = []; const h = engine.events.on('entity:stage', d => events.push(d.name));
        engine.clock.now += 100;   // grows while far too, by game time: seed(20) + sapling(20) are long past
        engine.step(3, { render: false });
        const grownAway = { stage: ent.state.stage, name: ent.stageName, noView: W.view('s1-sap') === null };
        h.remove();
        P.placeAt({ x: home.x, z: home.z }); engine.step(3);
        const back = { hasRoot: !!ent.object?.parent, red: ent.visual?.material.color.getHex() === 0xff0000, interactAdds };
        // save round trip
        engine.saves.save('s1-ent');
        const json = JSON.parse(atob(engine.saves.export('s1-ent')));
        ent.set('watered', true);
        engine.entities.spawn('s1grow', { id: 's1-extra', position: { x: home.x + 8, z: home.z } });
        engine.saves.load('s1-ent');
        const e2 = engine.entities.get('s1-sap');
        const restored = { watered: e2?.state.watered, extraGone: !engine.entities.get('s1-extra'), ownKey: json.parts.entities !== undefined,
          inWorld: json.parts.world.records['s1-sap']?.kind === 'entity:s1grow' };
        engine.step(0.3);
        const rebuilt = !!engine.entities.get('s1-sap').object?.parent;
        const listed = engine.describe().nearby.some(x => x.name === 's1-sap' && x.kind === 'entity');
        engine.entities.remove('s1-sap');
        return { near, away, events, grownAway, back, restored, rebuilt, listed, afterRemove: W.get('s1-sap') === undefined };
      });
      check('Data lives in world (kind entity:<type>), the view reads that data, and a nearby entity has a model and interactions', r.near.kind === 'entity:s1grow' && r.near.hasRoot && r.near.sameData && r.near.stageName === 'seed' && Math.abs(r.near.scale - 0.2) < 1e-6 && r.near.interactAdds === 1, JSON.stringify(r.near));
      check('Walk away: model / interactions torn down (dispose called), data remains', r.away.object === null && r.away.visual === null && r.away.viewGone && r.away.still && r.away.stage === 0 && r.away.disposed === 1 && r.away.interactRemoves === 1, JSON.stringify(r.away));
      check('Grows by game time with no model while far, spanning several stages at once', r.grownAway.stage === 2 && r.grownAway.name === 'tree' && r.grownAway.noView && r.events.length === 1, JSON.stringify({ g: r.grownAway, e: r.events }));
      check('Walk back: rebuilt for the new stage (model swapped), interactions re-attached', r.back.hasRoot && r.back.red && r.back.interactAdds === 2, JSON.stringify(r.back));
      check('Save: entity data is in the world save with no entities key of its own; load restores it and rebuilds the model', !r.restored.ownKey && r.restored.inWorld && !r.restored.watered && r.restored.extraGone && r.rebuilt, JSON.stringify(r.restored));
      check('describe reports nearby entities', r.listed);
      check('remove: data deleted', r.afterRemove);
    },
  },
];
