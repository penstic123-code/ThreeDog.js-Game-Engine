// Guards from the 0.7 review: ?fresh must never delete saves by accident, one place gives one standing height, and only real camera blockers cost a camera ray.
export const specs = [
  {
    name: '[guard] URL fresh: only true, 1 or bare act; outside dev a link is dropped with one warning; without a title, fresh then play starts a run',
    url: '/tests/ui/index.html?mode=default&threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await __t.until(() => engine.stateApplied, 10000);
        const slots = () => engine.saves.list().length, out = {};
        await engine.session.newGame(); engine.ui.close('title');
        await engine.saves.save('keep');
        await engine.applyState({ fresh: false }); await engine.applyState({ fresh: '0' });
        out.kept = slots();
        // a shipped game with urlState: true: the same class, told it is not in dev mode
        const warn = console.warn, said = [], search = location.search;
        console.warn = (...a) => said.push(a.join(' '));
        history.replaceState(null, '', location.pathname + search + '&fresh');
        const U = new engine._urlState.constructor(engine, { fromUrl: true, dev: false });
        await U.early();
        history.replaceState(null, '', location.pathname + search);
        console.warn = warn;
        out.shipped = slots(); out.dropped = U.pending.fresh === undefined; out.warned = said.filter(s => /\?fresh is ignored/.test(s)).length;
        // no title part: quit opens nothing, so play has no Start to press
        const open = engine.ui.open, starts = [];
        engine.ui.open = () => false;
        const h = engine.events.on('session:start', i => starts.push(i.kind));
        await engine.applyState({ fresh: true, play: true });
        engine.ui.open = open; h.remove();
        out.gone = slots(); out.starts = starts; out.playing = engine.session.playing;
        return out;
      });
      check('false and 0 delete nothing', r.kept === 1, JSON.stringify(r));
      check('outside dev ?fresh deletes nothing, is dropped and warns once', r.shipped === 1 && r.dropped && r.warned === 1, JSON.stringify(r));
      check('fresh then play without a title: saves gone, one new run started', r.gone === 0 && r.starts.join() === 'new' && r.playing, JSON.stringify(r));
    },
  },
  {
    name: '[guard] placement: a given y uses the step rule, no y the highest platform; the safe spot skips unsafe and moving platforms; an NPC gets one answer with and without a model',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE, P = engine.player, p = P.position, x = Math.round(p.x) + 40, z = Math.round(p.z), g = engine.surface(x, z), out = {};
        const slab = (dx, opts) => {
          const m = new T.Mesh(new T.BoxGeometry(4, 1, 4)); m.position.set(x + dx, g + 5, z); engine.scene.add(m); engine.characters.support(m, opts); return m;
        };
        slab(0); slab(10, { safe: false });
        const boat = slab(20);
        const y = v => engine.ops.allow(() => P.placeAt(v)).position.y - g;
        out.none = y({ x, z }); out.under = y({ x, y: g, z }); out.onTop = y({ x, y: g + 5.4, z }); out.array = y([x, g, z]);
        // the safe spot
        engine.ops.allow(() => P.placeAt({ x: x - 10, z }));
        const home = P.safeGround.clone();
        engine.ops.allow(() => P.placeAt({ x: x + 10, z })); engine.step(0.2);
        out.unsafeKept = P.safeGround.distanceTo(home) < 1e-6;
        const h = engine.onFixed(() => { boat.position.x += 0.02; });
        engine.ops.allow(() => P.placeAt({ x: x + 20, z })); engine.step(0.2);
        out.movingKept = P.safeGround.distanceTo(home) < 1e-6;
        h.remove();
        engine.ops.allow(() => P.placeAt({ x, z })); engine.step(0.2);
        out.stillTaken = Math.abs(P.safeGround.y - g - 5.5) < 0.01;
        // an NPC with no model stands where its model would
        const nx = x, nz = z, n = engine.npcs.add({ id: 'pc-deckhand', name: 'Deckhand', position: { x: nx, z: nz } }), ny = () => n.data.position.y - g;
        out.added = ny();
        engine.ops.allow(() => n.placeAt({ x: nx, y: g, z: nz })); out.npcUnder = ny();
        engine.ops.allow(() => n.placeAt({ x: nx, z: nz })); out.npcTop = ny();
        return out;
      });
      const near = (a, b) => Math.abs(a - b) < 0.01;
      check('no y: the highest platform', near(r.none, 5.5), JSON.stringify(r));
      check('a y under the deck stays under it, in object and array form', near(r.under, 0) && near(r.array, 0), JSON.stringify(r));
      check('a y within step height of the deck stands on it', near(r.onTop, 5.5), JSON.stringify(r));
      check('an unsafe platform and a moving one do not become the safe spot; a still safe one does', r.unsafeKept && r.movingKept && r.stillTaken, JSON.stringify(r));
      check('an NPC without a model follows the same rule', near(r.added, 5.5) && near(r.npcUnder, 0) && near(r.npcTop, 5.5), JSON.stringify(r));
    },
  },
  {
    name: '[guard] camera rays: a mesh that is no blocker costs one flag check; addStatic says what it skips; a solid content prop blocks, occluder: false does not',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE, out = {}, p = engine.player.position, x = Math.round(p.x), z = Math.round(p.z);
        const plain = new T.Mesh(new T.BoxGeometry(1, 1, 1)); plain.position.set(x, 50, z); engine.scene.add(plain); plain.updateMatrixWorld(true);
        const h = engine.rays.addStatic(plain);
        plain.geometry.boundingSphere = null;
        engine.raycast({ x, y: 60, z }, { x: 0, y: -1, z: 0 }, { far: 20, occluders: true });
        out.skipped = plain.geometry.boundingSphere === null;
        h.remove();
        const warn = console.warn, said = [];
        console.warn = (...a) => said.push(a.join(' '));
        engine.rays.addStatic(new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 1)).remove();
        engine.rays.addStatic(new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 1)).remove();
        console.warn = warn;
        out.warned = said.filter(s => /addStatic: skipped an InstancedMesh/.test(s)).length;
        const occ = () => [...engine.rays.statics.values()].filter(s => s.occ).length, all = () => engine.rays.statics.size, occ0 = occ(), all0 = all();
        engine.assets.manifest({ name: 'cb', models: { cbTree: () => new T.Mesh(new T.BoxGeometry(2, 4, 2)) } });
        const at = i => ({ x: x + 5 + i * 6, z: z + 8 });
        engine.content.load({ props: [{ model: 'cbTree', collide: 'box', id: 'cb-solid', ...at(0) }, { model: 'cbTree', collide: 'box', occluder: false, id: 'cb-thin', ...at(1) }, { model: 'cbTree', id: 'cb-open', ...at(2) }] });
        await __t.until(() => { engine.step(1 / 30); return all() >= all0 + 3; }, 8000);
        out.blockers = occ() - occ0;
        return out;
      });
      check('a camera ray never reaches the bounds test of a mesh that is no blocker', r.skipped, JSON.stringify(r));
      check('a skipped InstancedMesh warns once', r.warned === 1, JSON.stringify(r));
      check('of three props only the solid one without occluder: false blocks', r.blockers === 1, JSON.stringify(r));
    },
  },
  {
    name: '[guard] level blockers: userData.occluder = false reaches down a node, a hidden mesh does not block, a col_ mesh still does',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, world, collision, characters, level, THREE } = threedogThreads;
        const g = new THREE.Group(), box = name => { const m = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), new THREE.MeshBasicMaterial()); m.name = name; return m; };
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial()); floor.name = 'floor'; floor.userData.walkable = true;
        const glass = new THREE.Group(); glass.userData.occluder = false; glass.add(box('pane'));
        const hidden = box('hidden'); hidden.visible = false;
        g.add(floor, box('wall'), glass, hidden, box('col_edge'));
        const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'level-occ' });
        E.use(world(), collision(), characters({ npcs: false }), level({ scene: g }));
        await E.start();
        const names = [...E.rays.statics].filter(([, s]) => s.occ).map(([m]) => m.name).sort();
        E.dispose();
        return names;
      });
      check('blockers are the wall and the col_ mesh', r.join() === 'col_edge,wall', r.join());
    },
  },
];
