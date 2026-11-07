// A level is a content section, so it shares the section transaction with the rest of a pack (core/base/sections.js): a load overtaken by a save, a pack refused around
// a level, and sections standing on a level file. Each engine is headless on the threads page; level files are manifest builders held open by a gate, so a test
// decides when a "download" ends. Run: threedog test "Level sections"

const PAGE = '/tests/threads/';

/** Runs in the page: an engine with gated levels. Each level has a floor and a marker npc_home at x = its index + 1, so where something stands tells which level it saw */
const HARNESS = `(() => {
  const { mk, createEngine, THREE } = threedogThreads, T = threedogThreads.all;
  window.__lv = async (key, mods = []) => {
    const E = mk(createEngine, key), gates = {}, log = [], removed = [], loaded = [], failed = [], unhandled = [];
    const scene = (n, i) => {
      const g = new THREE.Group(); g.name = n;
      const floor = new THREE.Mesh(new THREE.BoxGeometry(40, 0.2, 40), new THREE.MeshBasicMaterial()); floor.name = 'ground'; g.add(floor);
      const m = new THREE.Object3D(); m.name = 'npc_home'; m.position.x = i + 1; g.add(m);
      return g;
    };
    const names = ['town', 'town2', 'cave', 'cave2', 'cave3', 'mine', 'mine2', 'mine3', 'bad'];   // a built model is cached: every load in a test gets its own name
    const gated = (n, i) => ({ build: async () => { await new Promise((res, rej) => { gates[n] = { open: res, fail: rej }; }); return scene(n, i); } });
    E.assets.manifest({ name: key, models: Object.fromEntries(names.map((n, i) => [n, gated(n, i)])) });
    const rec = { name: 'lsRec', type: 'rules', skipKind: 'none', content: { lsRec: { commit(d, { engine: e, where }) { log.push({ x: where({ place: 'npc_home' }).x, root: e.level.root?.name ?? null, allowed: e.ops._allowDepth > 0 }); } } } };
    const refuse = { name: 'lsRefuse', type: 'rules', skipKind: 'none', content: {
      lsValidate: { validate() { throw new Error('refused by validate'); }, commit() {} },
      lsPrepare: { prepare() { throw new Error('refused by prepare'); }, commit() {} },
      lsLate: { prepare: () => new Promise((res, rej) => { gates.late = { open: res, fail: rej }; }), commit() { log.push('late'); } },
    } };
    E.use(T.level(), T.content(), rec, refuse, ...mods.map(m => T[m]()));
    await E.start();
    const remove = E.remove; E.remove = (...o) => { removed.push(...o.map(x => x.name)); return remove.apply(E, o); };
    E.events.on('level:loaded', ({ root }) => loaded.push(root.name));
    E.events.on('level:failed', ({ source }) => failed.push(source));
    const onRej = ev => { unhandled.push(String(ev.reason?.message ?? ev.reason)); ev.preventDefault(); };
    window.addEventListener('unhandledrejection', onRej);
    const tick = () => new Promise(res => setTimeout(res, 20));
    const gate = async n => { for (let i = 0; i < 100 && !gates[n]; i++) await new Promise(res => setTimeout(res, 5)); return gates[n]; };
    const go = async n => { const p = E.level.load(n); (await gate(n)).open(); await p; delete gates[n]; };
    const end = () => { window.removeEventListener('unhandledrejection', onRej); E.dispose(); };
    const inScene = n => !!E.scene.getObjectByName(n);
    const state = () => ({ root: E.level.root?.name ?? null, file: E.modules.get('level').describe().file, ready: E.level.ready, loaded: [...loaded], failed: [...failed], removed: [...removed], log: [...log], unhandled: [...unhandled] });
    return { E, T, THREE, gates, gate, go, tick, end, inScene, state, scene, loaded, log };
  };
})()`;
const page = ev => ev(src => { (0, eval)(src); }, HARNESS);

export const specs = [
  {
    name: 'Level sections: a save naming the current level drops a load in flight, the save wins',
    url: PAGE,
    async run({ check, ev }) {
      await page(ev);
      const r = await ev(async () => {
        const { E, gate, go, tick, end, state, inScene } = await window.__lv('ls-save');
        await go('town');
        await E.saves.save('s');
        const p = E.level.load('cave'), g = await gate('cave');
        const ok = await E.saves.load('s');
        const during = E.level.ready;
        g.open(); await p; await tick();
        const out = { ...state(), ok, during, cave: inScene('cave') };
        end();
        return out;
      });
      const J = JSON.stringify(r);
      check('the save loaded', r.ok === true, J);
      check('the level is ready as soon as the save loaded: nothing is on its way any more', r.during === true, J);
      check('the file arriving later does not commit on top of the save', r.root === 'town' && r.file === 'town' && !r.cave && r.loaded.join() === 'town', J);
      check('it is let go: the wait ended, so no copy of it was ever made', !r.removed.includes('cave') && !r.cave, J);
    },
  },
  {
    name: 'Level sections: a pack refused around its level changes nothing -- ready, the load in flight, the file, the scene\'s nodes',
    url: PAGE,
    async run({ check, ev }) {
      await page(ev);
      const r = await ev(async () => {
        const { E, gates, gate, go, tick, end, state, THREE, scene } = await window.__lv('ls-refuse', ['world']);
        const refused = d => { try { E.content.load(d); return null; } catch (err) { return err.message; } };
        await go('town');
        const out = {};
        // a later validate: the load already on its way goes on, and the pack's file is never asked for
        const p = E.level.load('cave'), g = await gate('cave');
        out.validate = refused({ level: 'mine', lsValidate: 1 });
        await tick();
        out.mineAsked = !!gates.mine;
        g.open(); await p; await tick();
        out.afterValidate = state();

        // a later prepare: the same, with the level's prepare already run
        const p2 = E.level.load('town2'), g2 = await gate('town2');
        out.prepare = refused({ level: 'mine', lsPrepare: 1 });
        out.readyWhileOld = E.level.ready;
        g2.open(); await p2; await tick();
        out.afterOld = state();
        (await gate('mine'))?.open(); await tick();   // a refused pack's wait ended, so a file not yet started never starts

        // nothing else loading: ready at once; the file that arrives is let go
        out.again = refused({ level: 'mine2', lsPrepare: 1 });
        out.readyNow = E.level.ready;
        (await gate('mine2'))?.open(); await tick(); await tick();
        out.afterFile = state();

        // the file fails after the refusal: nobody is left to hear it
        refused({ level: 'mine3', lsPrepare: 1 });
        (await gate('mine3'))?.fail(new Error('late file failure')); await tick(); await tick();
        out.afterFail = state();
        // a code-built scene keeps the record nodes prepare took out
        const sc = scene('built', 9), node = new THREE.Object3D(); node.name = 'rec'; node.userData.id = true; sc.add(node);
        out.scene = refused({ level: sc, lsPrepare: 1 });
        out.nodeHome = node.parent === sc;
        out.readyScene = E.level.ready;
        end();
        return out;
      });
      const J = JSON.stringify(r);
      check('validate: refused, the load in flight commits, the pack\'s file was not asked for', /validate/.test(r.validate) && !r.mineAsked && r.afterValidate.root === 'cave' && r.afterValidate.ready, J);
      check('prepare: refused, the load in flight goes on and commits', /prepare/.test(r.prepare) && r.readyWhileOld === false && r.afterOld.root === 'town2' && r.afterOld.ready, J);
      check('prepare with nothing else loading: ready at once, no level:failed', /prepare/.test(r.again) && r.readyNow === true && !r.afterFile.failed.length, J);
      check('a file behind a refusal is let go, not committed', r.afterFile.root === 'town2' && !r.afterFile.loaded.includes('mine2') && r.afterFile.ready, J);
      check('a file failing after the refusal is nobody\'s error', !r.afterFail.unhandled.length && !r.afterFail.failed.length && r.afterFail.ready, J);
      check('a code-built scene gets its record nodes back', /prepare/.test(r.scene) && r.nodeHome && r.readyScene, J);
    },
  },
  {
    name: 'Level sections: sections stand on the pack\'s level file -- in order after it, across a list of packs, in the load window, and not at all when it fails',
    url: PAGE,
    async run({ check, ev }) {
      await page(ev);
      const r = await ev(async () => {
        const { E, gates, gate, go, tick, end, state, log } = await window.__lv('ls-order');
        await go('town');
        const out = {};
        E.content.load({ level: 'cave', lsRec: 1 });
        out.before = [...log]; out.waiting = E.content.ready;
        (await gate('cave')).open(); await tick(); await tick();
        out.one = state(); out.settled = E.content.ready;
        log.length = 0;
        E.content.load([{ level: 'mine' }, { lsRec: 1 }]);
        (await gate('mine'))?.open(); await tick();   // a refused pack's wait ended, so a file not yet started never starts await tick();
        out.list = state();
        log.length = 0;
        const quiet = console.error; console.error = () => {};
        E.content.load({ level: 'bad', lsRec: 1 });
        (await gate('bad')).fail(new Error('no such file')); await tick(); await tick();
        console.error = quiet;
        out.failed = state(); out.failedReady = E.content.ready;
        log.length = 0;
        // a pack whose level was overtaken: the level gives way, the rest goes in on the level that won
        E.content.load({ level: 'cave2', lsRec: 1 });
        const g = await gate('cave2');
        const p = E.level.load('town2'); (await gate('town2')).open(); await p;
        g.open(); await tick(); await tick();
        out.overtaken = state(); out.overtakenReady = E.content.ready;
        log.length = 0;
        // another section still waiting holds the level back too: all of a pack commits, or none
        E.content.load({ level: 'cave3', lsLate: 1, lsRec: 1 });
        (await gate('cave3')).open(); await tick();
        out.heldBack = state();
        (await gate('late')).fail(new Error('late section failed')); await tick(); await tick();
        out.refusedLate = state();
        end();
        return out;
      });
      const J = JSON.stringify(r);
      check('nothing commits before the file is here, and content is not ready', r.before.length === 0 && r.waiting === false, J);
      check('the section sees the new level\'s marker, after the commit', r.one.log.length === 1 && r.one.log[0].x === 3 && r.one.log[0].root === 'cave' && r.settled, J);
      check('a late commit is still loading, not gameplay: writes are allowed', r.one.log[0]?.allowed === true, J);
      check('a later pack of the list waits for the level of an earlier one', r.list.log.length === 1 && r.list.log[0].x === 6 && r.list.log[0].root === 'mine', J);
      check('a level file failing leaves the rest uncommitted, the old level up, content ready', !r.failed.log.length && r.failed.root === 'mine' && r.failed.failed.join() === 'bad' && r.failedReady, J);
      check('a pack whose level was overtaken: its other sections commit, on the newer level', r.overtaken.log.length === 1 && r.overtaken.log[0].root === 'town2' && r.overtaken.root === 'town2' && r.overtakenReady, J);
      check('a section still preparing holds the level back; its failure leaves the level and the rest uncommitted', r.heldBack.root === 'town2' && !r.refusedLate.log.length && r.refusedLate.root === 'town2' && r.refusedLate.ready, J);
    },
  },
];
