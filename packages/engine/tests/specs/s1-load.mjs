// Stream sources (engine.stream sources): teleport waits for the destination, leaving and coming back keeps world state, display-only sources build no colliders.
// Guards: every distance-based loader (terrain chunks, rigid colliders, world models, stream) reads engine.stream sources, so these fail if one of them goes back to engine.focus / the player.
const URL = '/?cutscene=skip';   // open world: terrain + rigid + world + inventory, camera follows the player


export const specs = [
  {
    name: 'S1 stream sources: teleport moves the player only after the destination is ready (terrain, collision, nearby models)',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        // step until cond() or the limit, yielding so worker replies arrive
        const pump = async (cond, max = 900) => { for (let i = 0; i < max && !cond(); i++) { engine.step(1 / 30); await new Promise(res => setTimeout(res, 0)); } return cond(); };
        engine.pause();
        const W = engine.world, P = engine.player, L = engine.stream, T = engine.THREE, home = P.position.clone();
        const dest = { x: home.x + 1500, z: home.z + 300 };
        W.present('ld-chest', { build: () => new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()), radius: 30 });
        W.add({ id: 'ld-chest-dest', kind: 'ld-chest', position: [dest.x + 4, 0, dest.z] });
        const before = { chunk: engine.terrain.isReadyAround(dest), ground: engine.rigid.groundReady(dest), view: !!W.view('ld-chest-dest') };
        let done = false, movedEarly = false;
        L.teleport(dest).then(() => { done = true; });
        const at = await pump(() => { if (!done && Math.hypot(P.position.x - home.x, P.position.z - home.z) > 1) movedEarly = true; return done; });
        const after = { chunk: engine.terrain.isReadyAround(dest, { solid: true }), ground: engine.rigid.groundReady(dest), view: !!W.view('ld-chest-dest'),
          off: Math.hypot(P.position.x - dest.x, P.position.z - dest.z), sources: L.sources().map(s => s.name) };
        return { before, at, movedEarly, after, builtins: [L.player.physics, L.camera.physics] };
      });
      check('destination not loaded before (test is meaningful)', !r.before.chunk && !r.before.ground && !r.before.view, JSON.stringify(r.before));
      check('teleport finished', r.at, JSON.stringify(r));
      check('player did not move before the destination was ready', !r.movedEarly);
      check('at arrival: terrain chunks and their collision, rigid ground and the nearby model are all there',
        r.after.chunk && r.after.ground && r.after.view && r.after.off < 1, JSON.stringify(r.after));
      check('the temporary destination source is gone after arrival', !r.after.sources.includes('teleport'), JSON.stringify(r.after.sources));
      check('built-in sources: player has physics, camera does not', r.builtins[0] === true && r.builtins[1] === false, JSON.stringify(r.builtins));
    },
  },
  {
    name: 'S1 stream sources: leave and come back, chest / drop / map changes are still right (models unload, records stay)',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        // step until cond() or the limit, yielding so worker replies arrive
        const pump = async (cond, max = 900) => { for (let i = 0; i < max && !cond(); i++) { engine.step(1 / 30); await new Promise(res => setTimeout(res, 0)); } return cond(); };
        engine.pause();
        const W = engine.world, P = engine.player, L = engine.stream, T = engine.THREE, I = engine.inventory, home = P.position.clone();
        const box = rec => { const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); m.userData.opened = !!rec.opened; return m; };
        W.present('ld-chest', { build: box, radius: 30 });
        W.present('ld-rock', { build: box, radius: 30 });
        W.add({ id: 'ld-chest', kind: 'ld-chest', position: [home.x + 3, 0, home.z], opened: false, items: ['coin'] });
        W.add({ id: 'ld-rock', kind: 'ld-rock', position: [home.x - 3, 0, home.z] });
        engine.step(0.2);
        // changes made here: open the chest and empty it, drop an item, break a rock and build a wall
        W.set('ld-chest', { opened: true, items: [] });
        I.spawnPickup('berry', [home.x + 2, 0, home.z + 2], { id: 'ld-drop' });
        W.remove('ld-rock');
        W.add({ id: 'ld-wall', kind: 'ld-rock', position: [home.x, 0, home.z - 4] });
        engine.step(0.2);
        const here = { chest: !!W.view('ld-chest'), drop: !!W.view('ld-drop'), wall: !!W.view('ld-wall') };
        const far = { x: home.x + 2000, z: home.z - 1200 };
        let ok = false; L.teleport(far).then(() => { ok = true; });
        await pump(() => ok);
        engine.step(3);   // the camera catches up, the old place unloads
        const away = { chest: W.view('ld-chest'), drop: W.view('ld-drop'), wall: W.view('ld-wall'),
          records: [W.get('ld-chest')?.opened, W.get('ld-chest')?.items.length, !!W.get('ld-drop'), W.get('ld-rock'), !!W.get('ld-wall')] };
        ok = false; L.teleport(home).then(() => { ok = true; });
        await pump(() => ok);
        engine.step(3);
        const back = { chest: W.view('ld-chest')?.userData.opened, drop: !!W.view('ld-drop'), rock: W.view('ld-rock'), wall: !!W.view('ld-wall'),
          items: W.get('ld-chest')?.items.length };
        return { here, away: { ...away, chest: away.chest === null, drop: away.drop === null, wall: away.wall === null }, back };
      });
      check('models were built at home', r.here.chest && r.here.drop && r.here.wall, JSON.stringify(r.here));
      check('away: every model unloaded', r.away.chest && r.away.drop && r.away.wall, JSON.stringify(r.away));
      check('away: records untouched (chest open and empty, drop there, rock gone, wall there)',
        JSON.stringify(r.away.records) === JSON.stringify([true, 0, true, undefined, true]), JSON.stringify(r.away.records));
      check('back: chest model rebuilt from the opened record, drop and wall back, broken rock stays gone',
        r.back.chest === true && r.back.drop && r.back.wall && r.back.rock === null && r.back.items === 0, JSON.stringify(r.back));
    },
  },
  {
    name: 'S1 stream sources: display-only source builds no colliders, simple detail builds no models, until removes, bad detail throws',
    url: URL,
    async run({ check, ev }) {
      const r = await ev(async () => {
        // step until cond() or the limit, yielding so worker replies arrive
        const pump = async (cond, max = 900) => { for (let i = 0; i < max && !cond(); i++) { engine.step(1 / 30); await new Promise(res => setTimeout(res, 0)); } return cond(); };
        engine.pause();
        const W = engine.world, L = engine.stream, T = engine.THREE, home = engine.player.position.clone();
        let builds = 0;
        W.present('ld-sign', { build: () => { builds++; return new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); }, radius: 30 });
        const cam = { x: home.x - 1400, z: home.z + 900 }, far = { x: home.x + 900, z: home.z + 1500 };
        W.add({ id: 'ld-sign-cam', kind: 'ld-sign', position: [cam.x + 2, 0, cam.z] });
        W.add({ id: 'ld-sign-far', kind: 'ld-sign', position: [far.x + 2, 0, far.z] });
        const view = L.source(cam, { physics: false, radius: 60 });
        let gone = false;
        const simple = L.source(far, { detail: 'simple', until: () => gone });
        const ready = await pump(() => view.ready && simple.ready);
        const CH = engine.ground.chunkSize, key = Math.floor(cam.x / CH) + ',' + Math.floor(cam.z / CH);
        const out = {
          ready, camChunk: engine.terrain.isReadyAround(cam), camColliders: engine.rigid.terrain.has(key), camGround: engine.rigid.groundReady(cam),
          camModel: !!W.view('ld-sign-cam'), farChunk: engine.terrain.isReadyAround(far), farModel: W.view('ld-sign-far') === null,
        };
        gone = true; engine.step(1 / 30);
        out.untilRemoved = !L.sources().includes(simple);
        view.remove();
        try { L.source(cam, { detail: 'low' }); } catch (e) { out.bad = e.message; }
        return out;
      });
      check('both sources became ready', r.ready, JSON.stringify(r));
      check('display-only source: terrain chunk and model loaded, but no rigid colliders there',
        r.camChunk && r.camModel && !r.camColliders && !r.camGround, JSON.stringify(r));
      check('simple source: terrain loaded, no world model', r.farChunk && r.farModel, JSON.stringify(r));
      check('until: the source removes itself', r.untilRemoved);
      check('a misspelled detail throws with the allowed values', /'full'.*'simple'/.test(r.bad ?? ''), r.bad);
    },
  },
];
