// Batch 7b leftovers: placement in three axes (rot / scale as [x,y,z], ground: false, tilted collide needs collider3d) and a plain volume as a trigger zone.
export const specs = [
  {
    name: 'placement: [x,y,z] rot and scale, ground: false keeps y, tilted collide without collider3d is a named error; a plain volume triggers',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = __threedogThree, tick = () => new Promise(res => setTimeout(res, 0)), W = engine.world;
        engine.haltLoop();
        engine.assets.manifest({ name: 'ps', models: { psBox: () => new T.Mesh(new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new T.MeshStandardMaterial()) } });
        const p = engine.player.position, x = p.x + 8, z = p.z + 8, out = {};
        engine.content.load({ props: [
          { id: 'ps-a', model: 'psBox', x, z, rot: [0.3, 0.5, 0], scale: [2, 1, 3], collide: false },
          { id: 'ps-b', model: 'psBox', x: x + 4, z, y: 40, ground: false, collide: false },
          { id: 'ps-c', model: 'psBox', x: x + 8, z, rot: 1, scale: 2, collide: false },
        ] });
        for (let i = 0; i < 60 && !(W.view('ps-a') && W.view('ps-b') && W.view('ps-c')); i++) { engine.step(0.05); await tick(); }
        const a = W.view('ps-a'), b = W.view('ps-b'), c = W.view('ps-c');
        out.a = [a.rotation.x, a.rotation.y, a.scale.x, a.scale.y, a.scale.z].map(v => +v.toFixed(2));
        out.bY = b.position.y; out.c = [c.rotation.y, c.scale.x, c.scale.y].map(v => +v.toFixed(2));
        // a tilted collide: with collider3d it makes a solid; without it, a named error
        const has = !!engine.collider3d;
        try { engine.content.load({ props: [{ id: 'ps-d', model: 'psBox', x, z: z + 5, rot: [0.4, 0, 0], collide: 'box' }] }); out.tilt = has ? 'ok' : 'no-error'; } catch (e) { out.tilt = has ? 'wrong:' + e.message : e.code; }
        out.has = has;
        // without a provider (the slot hidden for one call): the named error
        const slot = Object.getOwnPropertyDescriptor(engine, 'collider3d');
        try { Object.defineProperty(engine, 'collider3d', { value: undefined, configurable: true }); engine.content.load({ props: [{ id: 'ps-e', model: 'psBox', x, z: z + 9, rot: [0.4, 0, 0], collide: 'box' }] }); out.noProv = 'no-error'; } catch (e) { out.noProv = e.code; }
        finally { if (slot) Object.defineProperty(engine, 'collider3d', slot); else delete engine.collider3d; }
        // volume trigger
        let n = 0;
        const t = engine.triggers.add({ volume: { contains: q => Math.hypot(q.x - p.x, q.z - p.z) < 3, bounds: { min: { x: p.x - 3, y: p.y - 5, z: p.z - 3 }, max: { x: p.x + 3, y: p.y + 5, z: p.z + 3 } } }, onEnter: () => n++ });
        engine.step(0.05); engine.step(0.05);
        out.volIn = t.inside; out.volEnter = n; out.vol3 = t.contains({ x: p.x + 50, y: p.y, z: p.z });
        try { engine.triggers.add({ volume: {} }); out.volBad = 'no-error'; } catch (e) { out.volBad = e.code; }
        return out;
      });
      check('rot / scale arrays applied', JSON.stringify(r.a) === JSON.stringify([0.3, 0.5, 2, 1, 3]), r.a);
      check('numbers act as before', r.c[0] === 1 && r.c[1] === 2 && r.c[2] === 2, r.c);
      check('ground: false keeps y', r.bY === 40, r.bY);
      check('tilted collide: ' + (r.has ? 'solid made' : 'named error'), r.has ? r.tilt === 'ok' : r.tilt === 'content-misuse', r.tilt);
      check('no provider: named error', r.noProv === 'content-misuse', r.noProv);
      check('volume trigger fires enter and is inside', r.volIn === true && r.volEnter === 1 && r.vol3 === false, r);
      check('bad volume is a named error', r.volBad === 'module-params', r.volBad);
    },
  },
];
