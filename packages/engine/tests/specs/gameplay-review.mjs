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
    name: '[guard] heightfield: the road under a bridge survives whichever face of the deck comes first; a quest without steps is refused at define',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const T = await import('three'), { buildHeightfield } = await import('../../modules/level/heightfield.js');
      // a road at y 0 and a slab at 3..3.2 over it, as triangles in a given order; up: wound so the face looks up
      const quad = (y, up) => up ? [-2, y, -2, -2, y, 2, 2, y, 2, -2, y, -2, 2, y, 2, 2, y, -2] : [-2, y, -2, 2, y, 2, -2, y, 2, -2, y, -2, 2, y, -2, 2, y, 2];
      const field = (list, mirror = 1) => {
        const m = new T.Mesh(new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(list.flat(), 3)));
        m.scale.x = mirror; m.updateMatrixWorld(true);
        const f = buildHeightfield([m], { cellSize: 0.5, layerGap: 1.8, stepUp: 0.4 });
        return [+f.height(0.1, 0.1, 0.5).toFixed(2), +f.height(0.1, 0.1, 3.2).toFixed(2)];
      };
      const deckFirst = field([quad(0, true), quad(3.2, true), quad(3, false)]), bottomFirst = field([quad(0, true), quad(3, false), quad(3.2, true)]);
      const box = field([quad(3, false), quad(5.5, true)]);
      const mirrored = field([quad(0, true), quad(3.2, true), quad(3, false)], -1);   // Blender's mirror by negative scale: the winding flips, the surfaces do not
      check('a mirrored level keeps the road under its bridge', J(mirrored) === '[0,3.2]', J(mirrored));
      check('under and on the bridge, deck face first', J(deckFirst) === '[0,3.2]', J(deckFirst));
      check('under and on the bridge, bottom face first', J(bottomFirst) === '[0,3.2]', J(bottomFirst));
      check('a tall box standing alone: its bottom face is no floor', box[0] === 5.5 && box[1] === 5.5, J(box));
      const r = await ev(async () => {
        let msg = ''; try { engine.quests.define('review-empty', { title: 'x' }); } catch (err) { msg = err.message; }
        return { msg };
      });
      check('a quest without steps says so at define', /steps is a list/.test(r.msg), J(r));
    },
  },
  {
    name: '[guard] jumps: jumpBuffer 0 still jumps; coyoteTime 0 gives no free air jump after walking off an edge',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const T = __threedogThree, p = engine.player.position, out = {}, S = 1 / 60;
        const make = o => { const c = new (engine.player.constructor)(engine, { rig: { root: new T.Group() }, ...o }); engine.add(c.root); return c; };
        const a = make({ jumpBuffer: 0 });
        a.placeAt({ x: p.x + 4, z: p.z }); a.move(0, 0, false, S);
        a.jump(); a.move(0, 0, false, S);
        out.jumped = a.vy > 0;
        // a deck to walk off: no coyote time, one jump
        const deck = new T.Mesh(new T.BoxGeometry(2, 0.2, 2)); deck.position.set(p.x + 8, engine.surface(p.x + 8, p.z) + 3, p.z); engine.scene.add(deck);
        const h = engine.characters.support(deck, { id: 'review-deck' });
        const b = make({ coyoteTime: 0 });
        b.placeAt({ x: deck.position.x, z: deck.position.z });
        for (let i = 0; i < 90 && b.grounded; i++) b.move(1, 0, false, S);
        out.left = !b.grounded;
        b.jump(); b.move(0, 0, false, S);
        out.airVy = b.vy; out.jumpsLeft = b.jumpState().jumpsLeft;
        h.remove(); a.dispose(); b.dispose(); deck.removeFromParent();
        return out;
      });
      check('jumpBuffer: 0 jumps on the step it was asked', r.jumped, J(r));
      check('walked off with coyoteTime 0: the one jump is gone', r.left && r.airVy <= 0 && r.jumpsLeft === 0, J(r));
    },
  },
  {
    name: '[guard] NPC: waiting for a path it still falls and goes idle; a small arriveDistance is reached; a disposed rider leaves its platform; a record removed by world.remove frees its name',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const T = __threedogThree, p = engine.player.position, out = {}, x = p.x + 5, z = p.z, step = s => engine.step(s, { render: false, describe: false });
        const allow = f => engine.ops.allow(f);
        const npc = allow(() => engine.npcs.add({ id: 'review-fall', name: 'Fall', position: [x, 0, z], schedule: [{ at: 0, position: [x + 30, 0, z] }], repath: 100 }));
        step(0.1);
        const ch = npc.character, rec = npc.data;
        rec.nav.path = null; rec.nav.repath = 100; ch.root.position.y += 3; ch.grounded = false; ch.velocity.set(4, 0); const y0 = ch.root.position.y;
        step(0.25);
        out.fell = ch.root.position.y < y0 - 0.2; out.slowed = ch.velocity.length() < 4;
        allow(() => engine.npcs.remove('review-fall'));
        const near = allow(() => engine.npcs.add({ id: 'review-near', name: 'Near', position: [x, 0, z], schedule: [{ at: 0, position: [x + 3, 0, z] }], arriveDistance: 0.5 }));
        step(4);
        out.left = Math.hypot(near.position.x - (x + 3), near.position.z - z);
        allow(() => engine.npcs.remove('review-near'));
        // disposed on a platform: nothing carries it any more
        const deck = new T.Mesh(new T.BoxGeometry(4, 0.2, 4)); deck.position.set(x, engine.surface(x, z) + 1, z); engine.scene.add(deck);
        const h = engine.characters.support(deck, { id: 'review-lift' });
        const c = new (engine.player.constructor)(engine, { rig: { root: new T.Group() } }); engine.add(c.root);
        c.placeAt({ x, z }); c.move(0, 0, false, 1 / 60);
        out.rode = c.support.kind === 'platform';
        const at = c.root.position.x; c.dispose();
        deck.position.x += 2; step(0.05);
        out.carriedAfter = c.root.position.x !== at;
        h.remove(); deck.removeFromParent();
        // removed the plain way: same name again is a new NPC, without the old model
        const m = new T.Group();
        allow(() => engine.npcs.add({ name: 'ReviewName', position: [x, 0, z], model: m }));
        allow(() => engine.world.remove('ReviewName'));
        try { allow(() => engine.npcs.add({ name: 'ReviewName', position: [x, 0, z] })); out.again = true; } catch (err) { out.again = err.message; }
        out.oldModel = engine.npcs._runtime.get('ReviewName')?.model === m;
        allow(() => engine.npcs.remove('ReviewName'));
        return out;
      });
      check('no path yet: gravity and slowing down go on', r.fell && r.slowed, J(r));
      check('arriveDistance 0.5 is reached, not stopped 0.8 short', r.left < 0.55, J(r));
      check('a disposed rider is not carried', r.rode && !r.carriedAfter, J(r));
      check('world.remove frees the name and the runtime options', r.again === true && !r.oldModel, J(r));
    },
  },
  {
    name: '[guard] drawing between fixed steps: a moving character draws at stepBlend, gameplay keeps the step pose, a teleport is not swept, a frame write shows as it stands, the camera target blends for the rig only',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const T = __threedogThree, p = engine.player.position, out = {}, S = 1 / 60;
        const c = new (engine.player.constructor)(engine, { rig: { root: new T.Group() } }); engine.add(c.root);
        c.placeAt({ x: p.x + 4, z: p.z });
        const next = dx => { c.root.position.x += dx; engine.step(S, { render: false, describe: false }); };
        const draw = a => { engine.stepBlend = a; engine._render(S); return new T.Vector3().setFromMatrixPosition(c.root.matrixWorld).x; };
        next(0); next(0); const x0 = c.root.position.x;
        next(0.1); const x1 = c.root.position.x;
        const a = draw(0.25);
        out.mid = Math.abs(a - (x0 + (x1 - x0) * 0.25)) < 1e-4;
        out.truth = c.root.position.x === x1 && c.root.matrixAutoUpdate === true;
        out.full = Math.abs(draw(1) - x1) < 1e-6;
        // the rig's view of the same blend, and nothing left behind
        engine.stepBlend = 0.5; let seen = 0;
        engine._poses.around(c.root, () => { seen = c.root.position.x; });
        out.around = Math.abs(seen - (x0 + x1) / 2) < 1e-4 && c.root.position.x === x1;
        // written between steps (a tween): shown where it is
        c.root.position.x += 1; out.frameWrite = Math.abs(draw(0.25) - c.root.position.x) < 1e-6; c.root.position.x -= 1;
        // a teleport
        next(50); out.teleport = Math.abs(draw(0.25) - c.root.position.x) < 1e-6;
        c.dispose(); engine.stepBlend = 1;
        out.gone = !engine._poses.map.has(c.root);
        return out;
      });
      check('drawn at the blend', r.mid, J(r));
      check('gameplay still reads the step pose, the matrix goes back to automatic', r.truth, J(r));
      check('stepBlend 1 draws the latest step', r.full, J(r));
      check('around() lends the blended position and restores it', r.around, J(r));
      check('a write outside the step is drawn as it stands', r.frameWrite, J(r));
      check('a teleport is drawn at once', r.teleport, J(r));
      check('dispose drops the entry', r.gone, J(r));
    },
  },
  {
    name: '[guard] screenToGround on every camera kind; a rider on a platform moved in onFrame is carried before the rig reads it',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const T = __threedogThree, P = engine.player, out = { kinds: {} };
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
  {
    name: 'character carry: a platform moved in a fixed step carries its rider and turns it with position+yaw; a removed support lets it go',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const T = __threedogThree, p = engine.player, out = {}, step = s => engine.step(s, { render: false, describe: false });
        const x = p.position.x + 4, z = p.position.z;
        const deck = new T.Mesh(new T.BoxGeometry(6, 0.2, 6)); deck.position.set(x, engine.surface(x, z) + 1, z); engine.scene.add(deck); deck.updateMatrixWorld();
        const h = engine.characters.support(deck, { id: 'carry-deck', carry: 'position+yaw' });
        p.placeAt({ x, z }); step(0.2);
        out.on = p.support.kind === 'platform';
        const mover = engine.onFixed(() => { deck.position.x += 0.02; deck.rotation.y += 0.01; });
        const x0 = p.position.x, f0 = p.facing;
        step(0.5);
        out.moved = p.position.x - x0; out.deckMoved = deck.position.x - x; out.turned = p.facing - f0;
        h.remove();
        step(0.25);
        out.off = p.support?.kind !== 'platform';
        mover.remove(); deck.removeFromParent();
        return out;
      });
      check('the rider stands on the platform', r.on, J(r));
      check('it moves as far as the platform did', r.moved > 0.3 && Math.abs(r.moved - r.deckMoved) < 0.05, J(r));
      check('position+yaw turns it with the platform', r.turned > 0.1, J(r));
      check('after support.remove() it no longer rides', r.off, J(r));
    },
  },
  {
    name: '[guard] level.unload: no ground data of the old level is left; a file still loading when the level unloads does not leave ready false for good',
    url: '/tests/level/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const L = engine.level, had = !!L.heightfield;
        const p = L.load('/models/not-there.glb');
        L.unload();
        await p;
        return { had, hf: L.heightfield, ready: L.ready, root: L.root };
      });
      check('heightfield goes with the level, and nothing counts as loading', r.had && r.hf === null && r.ready === true && r.root === null, J(r));
    },
  },
];
