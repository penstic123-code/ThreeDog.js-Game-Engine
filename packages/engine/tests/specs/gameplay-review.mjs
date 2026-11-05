// Guards from the 2026-11-05 gameplay review: NPC options that are not plain stay out of the record, every camera kind answers screenToGround, the skip key
// reaches only the top of the UI focus stack, and a rider moved this frame is where the camera rig reads it. Swarm's step order: specs/swarm.mjs.
const J = JSON.stringify;
export const specs = [
  {
    name: '[guard] content.load reads a pack\'s places; the option goes on top; a text entry waits for the option',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const C = engine.content, at = n => { const p = C.where({ place: n }); return [p.x, p.z]; };
        C.load({ places: { reviewA: { x: 3, z: 4 }, reviewB: { x: 1, z: 1 }, reviewC: 'found at startup' } }, { places: { reviewB: { x: 7, z: 8 }, reviewC: { x: 5, z: 6 } } });
        return { a: at('reviewA'), b: at('reviewB'), c: at('reviewC') };
      });
      check('the pack gives a place, the option overrides it', J(r.a) === '[3,4]' && J(r.b) === '[7,8]' && J(r.c) === '[5,6]', J(r));
    },
  },
  {
    name: '[guard] NPC options that are not plain stay in memory, a re-add keeps them, the model still gets them',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const p = engine.player.position, out = {};
        const states = () => null, water = () => 'wade', fall = { belowY: () => -100 };
        const npc = engine.ops.allow(() => engine.npcs.add({ id: 'review-npc', name: 'Review', position: [p.x + 3, 0, p.z], states, water, fall, turnSpeed: 9 }));
        engine.step(0.1);
        const rec = engine.world.get('review-npc');
        out.look = Object.keys(rec.look).sort();
        out.saved = !/review-npc.*=>/.test(JSON.stringify(rec));
        out.model = [npc.character?.states === states, npc.character?.water === water, npc.character?.turnSpeed];
        engine.ops.allow(() => engine.npcs.add({ id: 'review-npc', name: 'Review', arriveDistance: 2 }));
        out.kept = engine.npcs._runtime.get('review-npc').water === water;
        engine.ops.allow(() => engine.npcs.add({ id: 'review-npc', name: 'Review', water: 'block' }));
        out.plainAgain = [engine.world.get('review-npc').look.water, engine.npcs._runtime.get('review-npc').water];
        engine.ops.allow(() => npc.remove());
        return out;
      });
      check('the record holds only the plain option', J(r.look) === J(['turnSpeed']) && r.saved, J(r));
      check('the model is built with all of them', r.model[0] && r.model[1] && r.model[2] === 9, J(r));
      check('a re-add that does not pass them keeps them', r.kept, J(r));
      check('a plain value replaces the function it took over from', r.plainAgain[0] === 'block' && r.plainAgain[1] === undefined, J(r));
    },
  },
  {
    name: '[guard] screenToGround on every camera kind; a rider on a platform moved in onFrame is carried before the rig reads it',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const T = engine.THREE, P = engine.player, out = { kinds: {} };
        const { x, z } = P.position, g = engine.surface(x, z);
        const slab = new T.Mesh(new T.BoxGeometry(6, 1, 6)); slab.position.set(x, g + 5, z); engine.scene.add(slab); engine.characters.support(slab);
        engine.ops.allow(() => P.placeAt({ x, z })); engine.step(0.2);
        const rig = engine.cameraRig, update = rig.update, seen = [], base = P.position.x - slab.position.x;
        rig.update = function (...a) { seen.push(P.position.x - slab.position.x); return update.apply(this, a); };
        const h = engine.onFrame(() => { slab.position.x += 0.25; });
        for (let i = 0; i < 6; i++) engine.step(1 / 60);
        h.remove(); rig.update = update;
        out.drift = Math.max(...seen.map(v => Math.abs(v - base))); out.frames = seen.length;
        for (const k of ['follow', 'firstPerson', 'fixed', 'rts']) {
          engine.setCamera(k);
          try { out.kinds[k] = typeof engine.cameraRig.screenToGround(0, 0); } catch (err) { out.kinds[k] = err.message; }
        }
        return out;
      });
      check('the rig reads the rider where the platform is this frame', r.frames >= 6 && r.drift < 1e-4, J(r));
      for (const k in r.kinds) check(`${k}: screenToGround answers`, r.kinds[k] === 'object', J(r.kinds));
    },
  },
  {
    name: '[guard] skip key: reaches the top of the UI focus stack only, not a cutscene under a dialogue or one frozen',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const E = engine, inp = E.input, out = {};
        E.timeline.skipAll = false;   // this page opens with ?cutscene=skip
        inp.bind({ skip: ['Backspace'] });
        const press = () => { inp._keyDown('Backspace', 'keyboard'); E.step(1 / 60); inp._keyUp('Backspace'); E.step(1 / 60); };
        const play = () => { const s = { over: null }; E.timeline.play([{ wait: 60 }], { actors: [] }).then(v => { s.over = v; }); return s; };
        const settle = async () => { for (let i = 0; i < 3; i++) { E.step(1 / 60); await Promise.resolve(); await new Promise(f => setTimeout(f)); } };

        let run = play(); E.step(1 / 60);
        const line = E.dialogue.say('A window above the cutscene');
        press(); await settle();
        out.underDialogue = run.over;
        line.remove(); await settle();
        press(); await settle();
        out.onTop = run.over?.skipped;

        run = play(); E.step(1 / 60);
        const f = E.freeze('review');
        press(); await settle();
        out.frozen = run.over;
        f.remove(); await settle();
        press(); await settle();
        out.thawed = run.over?.skipped;

        run = { over: null };
        E.timeline.play([{ say: { speaker: 'A', text: 'its own line' } }, { wait: 60 }], { actors: [] }).then(v => { run.over = v; });
        await settle();
        press(); await settle();
        out.ownLine = run.over?.skipped;
        return out;
      });
      check('a dialogue above it keeps the key', r.underDialogue === null, J(r));
      check('on top, the key skips it', r.onTop === true, J(r));
      check('frozen, the key does nothing', r.frozen === null && r.thawed === true, J(r));
      check("under its own line, the key still skips it", r.ownLine === true, J(r));
    },
  },
];
