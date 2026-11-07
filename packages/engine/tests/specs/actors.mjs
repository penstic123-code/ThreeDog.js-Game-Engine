// "Actor everywhere" guards (docs/plans/done/2026-11-02-genericity-fixes.md items 2 and 4): nothing in interactions, pickups, containers, content effects or
// triggers may assume one player. Each case has two actors (the local 'player' and a second one: a world record standing in for an NPC or a net peer,
// or real net peers) and checks that each one's action lands on that one. Same format as the other files here.
// Do not bypass: if any of these fails, some path went back to a fixed 'player' / engine.player / engine.actor.

// the second actor: a plain world record with a position (what a net peer's avatar on the host, or an NPC record, is)
const HELPER = 'helper-1';

export const specs = [
  {
    name: '[guard] actors: pickups go into the picker\'s container; onUse / enabled / label get the actor; item events name container and actor; content give / has follow the actor; trigger callbacks get the id (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        const HELPER = 'helper-1';   // ev() runs this function in the page: constants of this file do not exist there
        engine.haltLoop();
        const W = engine.world, I = engine.inventory, P = engine.pickups, p = engine.player.position;
        const out = {};
        engine.ops.allow(() => {
          I.define('act-gem', { name: 'gem' });
          // the helper stands 30 m away from the player: only it is in reach of what is placed next to it
          W.add({ id: HELPER, kind: 'act-helper', position: [p.x + 30, p.y, p.z] }, { save: false });
          const h = W.get(HELPER).position;
          const evs = []; engine.events.on('item:add', e => { if (e.id === 'act-gem') evs.push(`${e.container}/${e.actor}/${e.count}`); });
          // 1. a key pickup taken by the helper (pickup.take as the helper, as a net peer's request or an NPC's op would run): into the helper's bag
          P.spawn([h.x, h.y, h.z], { give: 'act-gem', id: 'act-p1' });
          out.take = engine.ops.run('pickup.take', { id: 'act-p1' }, { actor: HELPER });
          out.afterTake = { helper: I.of(HELPER).count('act-gem'), player: I.count('act-gem') };
          // the player is 30 m away: the same op as the player is refused (reach is measured from the actor, not from engine.player)
          P.spawn([h.x, h.y, h.z], { give: 'act-gem', id: 'act-p2' });
          { const f = engine.ops.run('pickup.take', { id: 'act-p2' }); out.playerFar = f.code; out.farFacts = f.facts; }
          // 2. auto pickup walked into by a second taker
          P.takers = e => [e.actor, HELPER];
          P.spawn([h.x, h.y, h.z], { give: 'act-gem', id: 'act-p3', auto: true, count: 2 });
          out.events = evs;
        });
        engine.step(0.2, { render: false });
        out.afterAuto = { helper: I.of(HELPER).count('act-gem'), player: I.count('act-gem'), gone: !W.get('act-p3') };
        out.eventsAfter = engine.events.recent('pickup:take').map(x => x.data).filter(x => String(x?.pickup).startsWith('act-')).map(x => `${x.pickup}/${x.actor}`);
        // 3. interactions: onUse / enabled / label are called with the actor that asks
        const seen = [];
        const h = W.get(HELPER).position;
        engine.interactions.add([h.x, h.y, h.z], { id: 'act-door', label: (o, { actor }) => { seen.push('label:' + actor); return 'door'; },
          enabled: (o, { actor }) => { seen.push('enabled:' + actor); return true; }, onUse: (o, { actor }) => { seen.push('use:' + actor); return actor; } });
        out.use = engine.ops.run('interaction.use', { id: 'act-door' }, { actor: HELPER });
        out.seen = seen.join();
        // 4. content effects / conditions follow the actor
        engine.ops.allow(() => { engine.content.run({ give: { 'act-gem': 5 } }, { actor: HELPER }); });
        out.content = { helper: I.of(HELPER).count('act-gem'), player: I.count('act-gem'), hasH: engine.content.test({ has: { 'act-gem': 5 } }, { actor: HELPER }),
          hasP: engine.content.test({ has: { 'act-gem': 1 } }) };
        // inside an op run by the helper, the default actor is the helper (ops.actor), not engine.actor
        if (!engine.ops.defs.has('act.reward')) engine.ops.define('act.reward', { run: e => e.content.run({ give: { 'act-gem': 1 } }) });
        engine.ops.run('act.reward', {}, { actor: HELPER });
        out.opReward = I.of(HELPER).count('act-gem');
        // 5. triggers: the callback and the event get the id of who entered
        const ids = [];
        const tz = engine.triggers.add({ position: { x: h.x, y: h.y - 1, z: h.z }, radius: 2, who: () => [HELPER, engine.actor], onEnter: (t, who, id) => ids.push('cb:' + id) });
        const tp = engine.triggers.add({ position: { x: p.x, y: p.y - 1, z: p.z }, radius: 2, onEnter: (t, who, id) => ids.push('default:' + id) });
        const hEv = engine.events.on('trigger:enter', x => { if (x.trigger === tz) ids.push('ev:' + x.id); });
        engine.step(0.1, { render: false });
        tz.remove(); tp.remove(); hEv.remove();
        out.trig = ids.join();
        W.remove(HELPER); engine._unhalt();
        return out;
      });
      check('pickup.take as a second actor: the item lands in that actor\'s container, not the player\'s', r.take.ok && r.afterTake.helper === 1 && r.afterTake.player === 0, JSON.stringify(r));
      check('reach is measured from the actor that takes it (the far player is refused)', r.playerFar === 'tooFar', r.playerFar);
      check('[guard] tooFar names the distance, the radius and where the thing is', r.farFacts?.distance > r.farFacts?.radius && typeof r.farFacts?.at?.x === 'number', JSON.stringify(r.farFacts));
      check('auto pickup: any taker walks into it, the item goes to that taker', r.afterAuto.helper === 3 && r.afterAuto.player === 0 && r.afterAuto.gone, JSON.stringify(r.afterAuto));
      check('item:add names the container and the actor for every bag', r.events[0] === `${HELPER}/${HELPER}/1`, JSON.stringify(r.events));
      check('pickup:take says who took it', r.eventsAfter.includes(`act-p1/${HELPER}`) && r.eventsAfter.includes(`act-p3/${HELPER}`), JSON.stringify(r.eventsAfter));
      check('interaction.use as an actor: enabled, onUse (and its value) get that actor', r.use.ok && r.use.value === HELPER && r.seen.includes(`enabled:${HELPER}`) && r.seen.includes(`use:${HELPER}`), JSON.stringify([r.use, r.seen]));
      check('content give / has take an actor; inside an op the op\'s actor is the default', r.content.helper === 8 && r.content.player === 0 && r.content.hasH && !r.content.hasP && r.opReward === 9, JSON.stringify([r.content, r.opReward]));
      check('trigger callbacks and events get the id of who entered (custom who with ids, and engine.actor for the default)', r.trig.includes(`cb:${HELPER}`) && r.trig.includes(`ev:${HELPER}`) && r.trig.includes('default:player'), r.trig);
    },
  },
  {
    name: '[guard] actors: a pickup with give: fn works with no inventory installed, for a taker that is not the local player',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, world, pickups } = threedogCoop;
        const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'act-noinv' });
        e.use(world(), pickups({ takers: () => ['bot'] }));
        await e.start();
        const got = [];
        let threw = '';
        e.ops.allow(() => {
          e.world.add({ id: 'bot', kind: 'bot', position: [5, 0, 0] }, { save: false });
          e.pickups.spawn([5, 0, 0], { give: (en, { actor, pickup }) => { got.push(actor + ':' + pickup.id); return 7; }, name: 'Medkit', auto: true, id: 'med' });
          try { e.pickups.spawn([0, 0, 0], { give: 'apple' }); } catch (x) { threw = x.message; }
        });
        e.step(0.2, { render: false });
        const out = { got, gone: !e.world.get('med'), inv: !!e.inventory, threw, hist: e.ops.recent('pickup.take').map(h => h.actor + '/' + h.ok) };
        e.dispose();
        return out;
      });
      check('instant-effect pickup: the give function runs with the taker, the record goes, no inventory needed', !r.inv && r.got.join() === 'bot:med' && r.gone && r.hist.join() === 'bot/true', JSON.stringify(r));
      check('an item pickup without inventory() throws and names both fixes', /inventory\(\)/.test(r.threw) && /give: \(e, \{ actor \}\)/.test(r.threw), r.threw);
    },
  },
  {
    name: '[guard] actors: npc.talk run as another actor turns the NPC to that actor, not to the local player (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const p = engine.player.position;
        engine.ops.allow(() => engine.world.add({ id: 'act-talker', kind: 'act-helper', position: [p.x + 1, p.y, p.z - 6] }, { save: false }));
        engine.npcs.add({ id: 'act-npc', name: 'Clerk', position: [p.x + 1, 0, p.z], interact: { op: 'npc.talk' }, schedule: [] });
        await __t.until(() => engine.npcs.character('act-npc'), 8000).catch(() => {});
        const ch = engine.npcs.character('act-npc');
        if (!ch) return { none: true };
        ch.face(0);   // the player stands 1 m to the NPC's -X, the talker 6 m to its -Z: two different directions
        const res = engine.ops.run('npc.talk', { npc: 'act-npc' }, { actor: 'act-talker' });
        const t = engine.world.get('act-talker').position, want = Math.atan2(t.x - ch.root.position.x, t.z - ch.root.position.z);
        const out = { ok: res.ok, code: res.code, facing: ch.facing, want };
        engine.dialogue.end(); engine.npcs.remove('act-npc'); engine.ops.allow(() => engine.world.remove('act-talker'));
        return out;
      });
      check('the NPC model exists (otherwise this guard tests nothing)', !r.none, JSON.stringify(r));
      check('npc.talk as act-talker faces act-talker', r.ok && Math.abs(Math.atan2(Math.sin(r.facing - r.want), Math.cos(r.facing - r.want))) < 0.05, JSON.stringify(r));
    },
  },
  {
    name: '[guard] pickups: an auto pickup that only comes from a save (fresh page, no spawn this session) is still walked into, at its own saved radius',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, world, pickups } = threedogCoop;
        const mk = key => { const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: key });
          e.use(world(), pickups({ takers: () => ['bot'] })); return e; };
        const a = mk('pk-save-a');
        await a.start();
        // radius 3 is wider than the default 2: the bot below stands 2.5 m away
        a.ops.allow(() => a.pickups.spawn([5, 0, 0], { give: () => 1, name: 'Medkit', auto: true, radius: 3, id: 'pk-saved' }));
        const data = a.saves.collect(); a.dispose();
        const b = mk('pk-save-b');
        await b.start();
        const ok = await b.saves.apply(data);
        b.ops.allow(() => b.world.add({ id: 'bot', kind: 'bot', position: [7.5, 0, 0] }, { save: false }));
        b.step(0.2, { render: false });
        // the give function is not saved data, so the take itself fails (noGive): what this guards is that the reach found the record at all
        const out = { ok, rec: !!b.world.get('pk-saved'), tries: b.ops.recent('pickup.take').filter(h => h.actor === 'bot').length };
        b.dispose();
        return out;
      });
      check('the loaded auto pickup is in reach of the taker (pickup.take was tried), with no spawn in this session', r.ok && r.rec && r.tries >= 1, JSON.stringify(r));
    },
  },
  {
    name: '[guard] actors over net: a peer walking into an auto pickup gets it in its own bag on the host (and sees it as player); a peer pressing for one is sent to the host',
    url: '/tests/net/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { fakeNetwork, makeCoop } = threedogCoop;
        const wire = fakeNetwork({ manual: true, latency: 40 });
        const H = await makeCoop('host', wire.host());
        const A = await makeCoop('client', wire.connect()), B = await makeCoop('client', wire.connect());
        const go = (ms = 300) => { for (let t = 0; t < ms; t += 1000 / 60) { wire.advance(1000 / 60); for (const e of [H, A, B]) e.step(1 / 60, { render: false }); } };
        go(300);
        const ga = A.net.actor;
        H.ops.allow(() => {
          H.pickups.spawn([9, 0, 0], { give: 'apple', auto: true, id: 'np-auto', count: 2 });
          H.pickups.spawn([-9, 0, 0], { give: 'bread', id: 'np-key' });
        });
        go(300);
        // A walks its own avatar onto the auto pickup (client-driven movement, sent to the host)
        A.ops.allow(() => A.world.move('player', { x: 9, y: 0, z: 0 }));
        go(1200);
        const afterAuto = { host: H.inventory.of(ga).count('apple'), hostOwn: H.inventory.count('apple'), aSees: A.inventory.count('apple'), b: B.inventory.count('apple'), gone: !H.world.get('np-auto') };
        // A presses for the key pickup next to it: the client run is a pending request, the host runs it as A
        A.ops.allow(() => A.world.move('player', { x: -9, y: 0, z: 0 }));
        go(2500);
        const press = A.ops.run('pickup.take', { id: 'np-key' });
        go(600);
        const out = { ga, afterAuto, press, bread: { host: H.inventory.of(ga).count('bread'), a: A.inventory.count('bread'), b: B.inventory.count('bread') },
          hist: H.ops.recent('pickup.take').map(h => h.source + '/' + h.actor + '/' + h.ok) };
        for (const e of [H, A, B]) e.dispose();
        return out;
      });
      check('auto pickup on the host for a peer: into that peer\'s container, synced to it as its own bag, nobody else gets it', r.afterAuto.host === 2 && r.afterAuto.aSees === 2 && r.afterAuto.hostOwn === 0 && r.afterAuto.b === 0 && r.afterAuto.gone, JSON.stringify(r));
      check('a client\'s pickup.take is a request: the host runs it as the peer and the item lands in the peer\'s bag', r.press.ok && r.press.pending && r.bread.host === 1 && r.bread.a === 1 && r.bread.b === 0 && r.hist.some(h => h === `net/${r.ga}/true`), JSON.stringify([r.press, r.bread, r.hist]));
    },
  },
  {
    name: '[guard] content words { op } and { can } run as the actor of the script, like give / take: a non-current actor entering a trigger',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const seen = [], H = 'ctx-helper';
        if (!engine.world.get(H)) engine.ops.allow(() => engine.npcs.add({ id: H, name: 'Helper', position: [engine.player.position.x + 3, 0, engine.player.position.z] }));
        engine.ops.define('ctx.probe', { can: (e, a, ctx) => { seen.push('can:' + ctx.actor); return true; }, run: (e, a, ctx) => { seen.push('run:' + ctx.actor); } });
        engine.content.run({ op: ['ctx.probe', {}] }, { actor: H });
        const ok = engine.content.test({ can: ['ctx.probe', {}] }, { actor: H });
        const h = engine.world.get(H).position;
        const z = engine.triggers.add({ position: { x: h.x, y: h.y - 1, z: h.z }, radius: 2, who: () => [H], onEnter: (t, who, id) => engine.content.run({ op: ['ctx.probe', {}] }, { actor: id }) });
        engine.step(0.1, { render: false });
        z.remove();
        return { seen, ok };
      });
      check('{ op } and { can } carry the actor given to content.run / test, also from a trigger entered by a non-current actor', r.ok && r.seen.filter(x => x.endsWith('ctx-helper')).length >= 5 && !r.seen.some(x => x === 'run:player'), JSON.stringify(r));
    },
  },
];
