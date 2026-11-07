// Apartment block, a shared acceptance scene: three storeys and a cellar under a lake on a composite ground, played through public names on the real engine in a real browser.
// The "do not bypass" checks: the ground answers per storey for a mover, a path, a stop and a zone alike, and a game reaches every one of them without a private field.
const PAGE = '/tests/apartment/';
const boot = async () => { for (let i = 0; i < 300 && !(window.game?.ready && engine.nav?.ready); i++) await new Promise(r => setTimeout(r, 100)); return !!window.game?.ready && !!engine.nav?.ready; };
const near = (a, b, d = 0.5) => Math.abs(a - b) < d;

export const specs = [
  {
    name: 'apartment ground: a composite ground answers per storey and per part, the cellar under the lake stays dry',
    url: PAGE, timeout: 120000,
    async run({ check, ev }) {
      check('the scene starts, navmesh included', await ev(boot));
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, o = {};
        e.haltLoop();
        o.h = [F.cellar, F.ground, F.first, F.second].map(y => e.surface(0, 0, y));
        o.top = e.surface(0, 0);
        o.bed = e.surface(15, 5, 0); o.under = e.surface(15, 5, F.cellar);
        o.hill = [e.surface(50, 50), 1 + Math.sin(50 * 0.05) * 2 + Math.cos(50 * 0.07) * 2];
        o.water = [e.waterAt(15, 5, 0), e.waterAt(15, 5, F.cellar)];
        // walked, not placed: down the ramp and on under the lake
        const p = g.one; p.placeAt([-3, 0, 0]);
        const swim = []; const off = e.events.on('character:water', w => swim.push(w.mode));
        const walk = await g.walk(p, [18, F.cellar, 3]);
        o.walk = walk.status; o.at = p.position.toArray(); o.state = p.state; o.swim = swim; o.inWater = e.describe().player?.inWater;
        off.remove?.();
        // the lake itself, from the pier: this is water
        p.placeAt([15, 0, 0]); await g.run(0.2);
        const c = e.control.take(p, { owner: 'test', layer: 'script', step: () => ({ x: 0, z: 1 }) });
        await g.run(2); c.remove(); await g.run(1);
        o.lake = { state: p.state, y: p.position.y, z: p.position.z };
        return o;
      });
      check('each storey has its own height', r.h.join() === '-4,0,3.5,7', r.h.join());
      check('no height means the top', r.top === 7, r.top);
      check('over the cellar the lake bed, under it the cellar', r.bed === -1.5 && r.under === -4, `${r.bed} ${r.under}`);
      check('outside the level the terrain part answers', near(r.hill[0], r.hill[1], 0.2), r.hill.join());
      check('water goes by height', r.water[0] === -0.4 && r.water[1] === -Infinity, r.water.join());
      check('a walk reaches the cellar under the lake', r.walk === 'arrived' && near(r.at[1], -4), `${r.walk} ${r.at}`);
      check('and no one swims there', r.swim.length === 0 && r.state !== 'swim' && !r.inWater, JSON.stringify([r.swim, r.state, r.inWater]));
      check('off the pier the same lake is water', r.lake.state === 'swim', JSON.stringify(r.lake));
    },
  },
  {
    name: 'apartment collision: a wall upstairs stops the first floor only, for walkers and paths',
    url: PAGE, timeout: 120000,
    async run({ check, ev }) {
      await ev(boot);
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, o = {}, p = g.one;
        e.haltLoop();
        const push = async y => {
          p.placeAt([2, y, 0]); await g.run(0.2);
          const c = e.control.take(p, { owner: 'test', layer: 'script', step: () => ({ x: 1, z: 0 }) });
          await g.run(1.5); c.remove(); await g.run(0.5);
          return p.position.toArray();
        };
        o.up = await push(F.first); o.down = await push(F.ground);
        const len = a => a ? a.reduce((s, q, i) => i ? s + Math.hypot(q.x - a[i - 1].x, q.z - a[i - 1].z) : 0, 0) : -1;
        o.pUp = len(e.characters.findPath([2, F.first, 0], [7, F.first, 0]));
        o.pDown = len(e.characters.findPath([2, F.ground, 0], [7, F.ground, 0]));
        o.walk = [e.collision.walkable([4.2, F.ground, 0]), e.collision.walkable([4.2, F.first, 0])];
        // a box the game adds at run time on one storey
        const box = e.collision.addBox([0, F.second, 0], { halfWidth: 10, halfDepth: 0.4, y: F.second, height: 2 });
        await g.run(0.2);
        o.box = [e.collision.walkable([0, F.first, 0]), e.collision.walkable([0, F.second, 0])];
        box.remove();
        return o;
      });
      check('the partition stops a walker on the first floor', r.up[0] < 4.2 && near(r.up[1], 3.5), r.up.join());
      check('the same walk in the lobby passes under it', r.down[0] > 4.6 && near(r.down[1], 0), r.down.join());
      check('a path upstairs goes round it, the lobby path goes straight', r.pUp > 6 && near(r.pDown, 5), `${r.pUp} ${r.pDown}`);
      check('walkable goes by storey', r.walk.join() === 'true,false', r.walk.join());
      check('a box added on one storey blocks that storey', r.box.join() === 'true,false', r.box.join());
    },
  },
  {
    name: 'apartment schedule: a caretaker walks every storey down to the cellar by its stops, on the real navmesh',
    url: PAGE, timeout: 150000,
    async run({ check, ev }) {
      await ev(boot);
      const r = await ev(async () => {
        const e = engine, g = game, n = g.caretaker, F = g.FLOOR, o = { legs: [], jump: 0 };
        e.haltLoop();
        let last = n.position.clone();
        for (const time of [10 / 24, 12 / 24, 14 / 24]) {   // the stops' clock times
          e.calendar.timeOfDay = time;
          for (let i = 0; i < 70; i++) {
            await g.run(0.5);
            const d = n.position.distanceTo(last); if (d > o.jump) o.jump = d;
            last = n.position.clone();
          }
          o.legs.push([time, n.position.x, n.position.y, n.position.z].map(v => (typeof v === 'number' ? +v.toFixed(2) : v)));
        }
        return o;
      });
      check('first floor reached', near(r.legs[0][2], 3.5) && near(r.legs[0][1], 6, 1), r.legs[0].join());
      check('lobby reached', near(r.legs[1][2], 0) && near(r.legs[1][1], 6, 1), r.legs[1].join());
      check('cellar reached under the lake', near(r.legs[2][2], -4) && near(r.legs[2][1], 12, 1), r.legs[2].join());
      check('it walked: no jump bigger than half a second of walking', r.jump < 3, r.jump);
    },
  },
  {
    name: 'apartment seats: real key presses reach each seat, up a ramp, and the door counts each entrant',
    url: PAGE, timeout: 120000,
    async run({ page, check, ev, wait }) {
      await ev(boot);
      await page.locator('#view').click({ position: { x: 5, y: 5 } }).catch(() => {});
      const pos = () => ev(() => [game.one.position.toArray(), game.two.position.toArray()]);
      const moved = (a, b, i) => Math.hypot(b[i][0] - a[i][0], b[i][2] - a[i][2]);
      const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); await wait(500); };
      const a = await pos(); await hold('KeyI', 800); const b = await pos(); await hold('KeyW', 800); const c = await pos();
      check('the seat\'s key moves the second player only', moved(a, b, 1) > 0.5 && moved(a, b, 0) < 0.05, `${moved(a, b, 0)} ${moved(a, b, 1)}`);
      check('the first player\'s key moves the first only', moved(b, c, 0) > 0.5 && moved(b, c, 1) < 0.05, `${moved(b, c, 0)} ${moved(b, c, 1)}`);
      const both = await pos();
      await page.keyboard.down('KeyI'); await page.keyboard.down('KeyW'); await wait(700); await page.keyboard.up('KeyI'); await page.keyboard.up('KeyW'); await wait(500);
      const d = await pos();
      check('both held at once, both walk', moved(both, d, 0) > 0.5 && moved(both, d, 1) > 0.5);

      const r = await ev(async () => {
        const e = engine, g = game, o = {};
        e.haltLoop();
        // the yard to the lobby, one after the other, through the front door
        g.one.placeAt([-14, 0, 0]); g.two.placeAt([-14, 0, 3]); await g.run(0.2);
        g.entries.length = 0; g.exits.length = 0;   // the key presses above may have walked someone through already
        const walk = (c, to) => c.walkTo(to);
        const w1 = walk(g.one, [-5, 0, 0]); await g.run(1.4);
        o.inside = [g.door.inside, [...g.entries]];
        const w2 = walk(g.two, [-5, 0, 2]); await g.run(10);
        o.w = [(await w1).status, (await w2).status];
        o.entries = [...g.entries]; o.exits = [...g.exits]; o.after = g.door.inside;
        // straight under the landing zone, then in it
        g.one.placeAt([0, g.FLOOR.ground, 0]); await g.run(0.5); o.below = e.vars.counter('landingEntered');
        g.one.placeAt([0, g.FLOOR.first, 0]); await g.run(0.5); o.above = e.vars.counter('landingEntered');
        return o;
      });
      check('both walked through the door', r.w.join() === 'arrived,arrived', r.w.join());
      check('one enter and one exit each', r.entries.join() === 'player,two' && r.exits.join() === 'player,two', JSON.stringify([r.entries, r.exits]));
      check('the zone is empty afterwards', r.after === false);
      check('a zone one storey up hears nothing from the lobby', r.below === 0 && r.above === 1, `${r.below} ${r.above}`);
    },
  },
  {
    name: 'apartment seats act for their player: a key press and a hold reach what that player stands by, steps sound for both, NPCs give way to both',
    url: PAGE, timeout: 120000,
    async run({ page, check, ev, wait }) {
      await ev(boot);
      await page.locator('#view').click({ position: { x: 5, y: 5 } }).catch(() => {});
      const tap = async (key, ms = 150) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); await wait(250); };
      await ev(() => {
        const g = game; g.used = [];
        g.one.placeAt([-6, 0, 0]); g.two.placeAt([-14, 0, 3]);
        g.valve = engine.interactions.add({ x: -14, y: 0, z: 3.5 }, { id: 'valve', label: 'Valve', radius: 1.5, onUse: (_o, { actor }) => { g.used.push(`valve:${actor}`); } });
      });
      await tap('KeyE'); await tap('KeyO');
      const tapped = await ev(() => { const last = engine.ops.recent('interaction.use'); game.valve.remove(); return { used: game.used.join(), actors: last.map(h => `${h.actor}:${h.ok ? 'ok' : h.code}`).join() }; });
      check('the seat\'s key uses what its own player stands by, and the op acts as that player', tapped.used === 'valve:two' && /two:ok/.test(tapped.actors), JSON.stringify(tapped));
      check('the first player\'s key, far from it, finds nothing', /player:nothingNear/.test(tapped.actors), tapped.actors);
      await ev(() => { const g = game; g.used = []; g.crank = engine.interactions.add({ x: -14, y: 0, z: 3.5 }, { id: 'crank', label: 'Crank', radius: 1.5, hold: 0.2, onUse: (_o, { actor }) => { g.used.push(`crank:${actor}`); } }); });
      await tap('KeyE', 500);
      const none = await ev(() => game.used.length);
      await tap('KeyO', 500);
      const r = await ev(async () => {
        const e = engine, g = game, o = { used: g.used.join(), none: 0 };
        g.crank.remove();
        // 'facing' reads the second player's own body: what it faces counts, what is behind it does not
        const I = e.interactions, ahead = g.two.root.getWorldDirection(new g.two.root.position.constructor()), at = s => ({ x: g.two.position.x + ahead.x * s, y: g.two.position.y, z: g.two.position.z + ahead.z * s });
        const pickAt = s => { const h = I.add(at(s), { id: 'side', label: 'Side', radius: 2 }), got = I.pick('two')?.id ?? null; h.remove(); return got; };
        I.pickMode = 'facing'; o.body = [pickAt(1), pickAt(-1)]; I.pickMode = 'nearest';
        const far = e.interactions.add({ x: -8, y: 0, z: 3 }, { id: 'far', label: 'Far', radius: Infinity, approach: true, onUse() {} });
        o.approach = [e.ops.can('interaction.use', { id: 'far' }, { actor: 'two' }).code ?? 'ok', e.ops.can('interaction.use', { id: 'far' }, { actor: 'caretaker' }).code ?? 'ok'];
        far.remove();
        // steps: each player sounds its own, an NPC none
        const sounds = [], sfx = e.audio.sfx; e.audio.sfx = n => { sounds.push(n); };
        e.haltLoop();
        g.one.placeAt([3, g.FLOOR.second, 2]); g.two.placeAt([20, 0, 0]); await g.run(0.2);
        const npc = g.caretaker, ch = npc.character;
        for (const c of [g.one, g.two, ch]) e.events.emit('character:step', { character: c });
        o.steps = sounds.length; e.audio.sfx = sfx;
        // giving way: a push with the second player out of reach moves nothing, with it on top of the NPC it does
        const push = () => { const p = ch.root.position, x = p.x, z = p.z; e.npcs.avoid._gridN = -1; e.npcs.avoid.push(npc.data, ch, 1 / 60); return Math.hypot(p.x - x, p.z - z); };
        await g.run(1 / 60); o.alone = push();
        g.two.placeAt([ch.root.position.x + 0.1, g.FLOOR.second, ch.root.position.z]); await g.run(1 / 60); o.pressed = push();
        e.characters.removePlayer('two'); o.seat = g.seat.actor;
        return o;
      });
      check('a hold runs on the seat that started it; the first player\'s hold finds nothing there', none === 0 && r.used === 'crank:two', JSON.stringify([none, r.used]));
      check('the second player has a body to face with, and may approach; an NPC actor still cannot', r.body[0] === 'side' && r.body[1] === null && r.approach.join() === 'ok,cannotWalk', JSON.stringify([r.body, r.approach]));
      check('both players sound their steps, an NPC does not', r.steps === 2, String(r.steps));
      check('an NPC gives way to the second player', r.alone === 0 && r.pressed > 0, JSON.stringify([r.alone, r.pressed]));
      check('removing the player frees its seat', r.seat === null, String(r.seat));
    },
  },
  {
    name: 'apartment seats on a ramp and a saved storey: a held key climbs, a load puts each player back on its floor',
    url: PAGE, timeout: 120000,
    async run({ page, check, ev, wait }) {
      await ev(boot);
      await page.locator('#view').click({ position: { x: 5, y: 5 } }).catch(() => {});
      // which key is +x depends on the camera, so the page says it: turn the seat's key into a world direction first
      await ev(() => { game.two.placeAt([-7.5, 0, 6]); });
      await wait(200);
      const dir = await ev(() => { const c = engine.camera, v = new (c.position.constructor)(); c.getWorldDirection(v); return [v.x, v.z]; });
      const key = Math.abs(dir[0]) > Math.abs(dir[1]) ? (dir[0] > 0 ? 'KeyI' : 'KeyK') : (dir[1] > 0 ? 'KeyJ' : 'KeyL');
      await page.keyboard.down(key); await wait(3500); await page.keyboard.up(key); await wait(300);
      const ramp = await ev(() => game.two.position.toArray());
      check('a held seat key climbs the ramp', ramp[1] > 1.5, `${key} ${ramp}`);
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, o = {};
        e.haltLoop();
        g.one.placeAt([0, F.second, 0]); g.two.placeAt([0, F.cellar, 0]); await g.run(0.3);
        await e.saves.save('floors');
        g.one.placeAt([-5, 0, 0]); g.two.placeAt([-5, 0, 3]); await g.run(0.3);
        await e.saves.load('floors'); await g.run(0.3);
        o.y = [e.player.position.y, e.characters.player?.('two')?.position.y ?? g.two.position.y];
        o.rec = e.world.get('two')?.position?.y;
        return o;
      });
      check('after a load each player is back on its own storey', near(r.y[0], 7) && near(r.y[1], -4), JSON.stringify(r));
    },
  },
  {
    name: 'apartment quest: the branch follows what the game knows, both ways, and survives a save',
    url: PAGE, timeout: 120000,
    async run({ check, ev }) {
      await ev(boot);
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, o = {}, p = g.one;
        e.haltLoop();
        const step = () => e.quests.state('leak').step;   // an index: look 0, call 1, pump 2
        o.start = step(); await e.saves.save('fresh');
        await g.walk(p, [12, F.cellar, 0]);
        await g.run(0.5);
        o.called = [step(), e.quests.state('leak').visited];
        await e.saves.save('quest');
        e.vars.setFlag('told'); await g.run(0.5);
        o.done = e.quests.isDone('leak');
        await e.saves.load('quest'); await g.run(0.2);
        o.back = [step(), e.quests.isDone('leak')];
        e.vars.setFlag('told'); await g.run(0.5);
        o.done2 = e.quests.isDone('leak');
        // the other way: the pump was found first
        await e.saves.load('fresh'); p.placeAt([0, F.ground, 0]); e.vars.setFlag('hasPump'); await g.run(0.3);
        await g.walk(p, [12, F.cellar, 0]);
        await g.run(0.5);
        o.pumpStep = step();
        return o;
      });
      check('starts on the first step', r.start === 0, r.start);
      check('walking into the cellar takes the branch with no pump', r.called[0] === 1 && r.called[1].join() === 'look', JSON.stringify(r.called));
      check('next: false ends the quest there', r.done === true);
      check('a load puts the quest back on the branch', JSON.stringify(r.back) === JSON.stringify([r.called[0], false]) && r.done2 === true, JSON.stringify(r.back));
      check('with the pump the same step goes the other way', r.pumpStep === 2, r.pumpStep);
    },
  },
  {
    name: 'apartment uneven ground: [x, 0, z] on bumps walks and arrives on the navmesh and on A*, and A* floors go through the path rule',
    url: PAGE, timeout: 150000,
    async run({ check, ev }) {
      await ev(boot);
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, o = {}, p = g.one;
        e.haltLoop();
        const warns = [], cw = console.warn; console.warn = (...a) => { const s = a.join(' '); if (s.includes('nav-height')) warns.push(s); cw(...a); };
        const spots = [[-15.7, 0], [-20.2, 5.24], [-24, -7]];   // the top of a bump, the bottom of a dip, two in between
        const round = async () => {
          const out = [];
          for (const [x, z] of spots) {
            p.placeAt([-13, 1, 1]); await g.run(0.3);
            const w = await g.walk(p, [x, 0, z], 15);
            const s = w.status;
            out.push([s, +Math.hypot(p.position.x - x, p.position.z - z).toFixed(2), +(p.position.y - g.yardHeight(p.position.x, p.position.z)).toFixed(2)]);
          }
          return out;
        };
        o.nav = await round();
        // a schedule stop written the same way
        const n = e.npcs.add({ id: 'gardener', name: 'Gardener', position: [-13, 1, -3], schedule: [{ at: 0, position: [-15.7, 0, 0] }] });
        await g.run(12); o.npc = [n.position.x, n.position.y, n.position.z]; e.npcs.remove(n);
        o.warns = warns.length;
        // without a navmesh: A* keeps to one floor; a game's stairs go through the characters.path rule
        e.nav.dispose();
        o.flat = e.characters.findPath([-6, 0, 0], [6, F.second, 2], { detailed: true }).status;
        o.astar = await round();
        // the corner at -9, -3 keeps the last leg off the stairwell: a straight line from the ramp's top crosses the hole
        const up = [[-8, 0, 6], [2, F.first, 6], [3, F.first, -6], [2, F.first, -6], [-8, F.second, -6], [-9, F.second, -3], [6, F.second, 2]].map(([x, y, z]) => ({ x, y, z }));
        const rule = e.mod('characters.path', { owner: 'game', set: () => up });
        p.placeAt([-9, 0, 6]); await g.run(0.3);
        let done = null; p.walkTo([6, F.second, 2]).then(a => { done = a; }); o.trail = []; for (let i = 0; i < 25 && !done; i++) { await g.run(1.2); o.trail.push([p.position.x, p.position.y, p.position.z].map(v => +v.toFixed(1)).join(' ')); } const w = done ?? { status: 'running' };
        o.stairs = [w.status, p.position.y];
        rule.remove();
        console.warn = cw;
        return o;
      });
      const ok = a => a.every(([s, d, dy]) => s === 'arrived' && d < 1 && Math.abs(dy) < 0.5);
      check('every [x, 0, z] target is reached on the navmesh, feet on the ground', ok(r.nav), JSON.stringify(r.nav));
      check('a stop written the same way is reached', near(r.npc[0], -15.7, 1) && near(r.npc[2], 0, 1) && near(r.npc[1], 1.4, 0.6), r.npc.join());
      check('heights within reach of the ground do not warn', r.warns === 0, r.warns);
      check('A* says it has no way to another floor', r.flat !== 'ok', r.flat);
      check('every [x, 0, z] target is reached on A*', ok(r.astar), JSON.stringify(r.astar));
      check('a game\'s stairs through characters.path take a walker upstairs without a navmesh', r.stairs[0] === 'arrived' && near(r.stairs[1], 7), r.stairs.join() + ' ' + r.trail.join('|'));
    },
  },
  {
    // Real Rapier (the page's ?rapier) through the mover's and the buoyancy's own e.waterAt(x, z, y): a floor below the water level, the lake itself, plain water
    name: 'apartment rapier: the character mover and buoyancy under the lake, in it and in plain water, on real physics',
    url: PAGE + '?rapier', timeout: 120000,
    async run({ check, ev }) {
      check('the scene starts, navmesh included', await ev(boot));
      const r = await ev(async () => {
        const e = engine, g = game, F = g.FLOOR, R = e.rigid, p = g.one, T = g.THREE, o = {};
        e.haltLoop();
        for (let i = 0; i < 300 && !(R.ready && R.readyAt(p.position)); i++) await g.run(0.05);
        await g.run(0.3);
        const at = () => p.position.toArray().map(v => +v.toFixed(2));
        const go = async (x, z, s) => { const c = e.control.take(p, { owner: 'test', layer: 'script', step: () => ({ x, z }) }); await g.run(s); c.remove(); await g.run(0.2); return { at: at(), state: p.state }; };
        o.mover = [p.mover.name, !!p.mover.controller];
        p.placeAt([-6, F.ground, 0]); await g.run(0.2);
        o.house = await go(1, 0, 1.5);
        // the cellar, walked on under the lake
        p.placeAt([4, F.cellar, 0]); await g.run(0.2);
        const swims = [], off = e.events.on('character:water', w => swims.push(w.mode));
        o.cellar = await go(1, 0, 3); o.cellarWater = e.waterAt(p.position.x, p.position.z, p.position.y); o.swims = swims.slice(); off.remove?.();
        // off the pier into the lake
        p.placeAt([15, F.ground, 0]); await g.run(0.2);
        o.lake = await go(0, 1, 2);
        // swimming, then put in the dry cellar right under it: the mover's next step asks for water there and there is none
        p.placeAt([15, F.cellar, 3]); await g.run(0.5);
        o.moved = { at: at(), state: p.state, swimming: p.swimming };
        // bodies: in the lake, in the cellar under it, in plain water
        const box = (x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), new T.MeshBasicMaterial()); m.position.set(x, y, z); e.add(m); return R.addBox(m); };
        const pool = e.addWaterBody({ position: [-20, 0, 0], radius: 6, level: 3 });
        const inLake = box(20, 6, 6), inCellar = box(15, -3, 4), inPool = box(-20, 4, 2);
        await g.run(6);
        const look = b => { const t = b.body.translation(), v = b.body.linvel(); return { y: +t.y.toFixed(2), vy: +v.y.toFixed(2), wet: !!b.wet, damping: +b.body.linearDamping().toFixed(2) }; };
        o.bodies = { lake: look(inLake), cellar: look(inCellar), pool: look(inPool) };
        // the player in the plain water: its level is well above the yard's bumps
        p.placeAt([-20, 0, 0]); await g.run(0.5);
        o.pool = { at: at(), state: p.state, want: 3 - p.swimDepth };
        pool.remove(); await g.run(3);
        o.poolGone = { box: look(inPool), yard: e.surface(-20, 2), at: at(), ground: e.surface(p.position.x, p.position.z), state: p.state };
        // past the level's region the terrain is the ground again
        p.placeAt([45, 0, 0]); await g.run(0.5);
        o.hill = { at: at(), ground: e.surface(45, 0) };
        // swimming, and the water goes
        p.placeAt([15, F.ground, 0]); await g.run(0.2); await go(0, 1, 2);
        g.lake.remove(); await g.run(1);
        o.drained = { at: at(), state: p.state, swimming: p.swimming };
        return o;
      });
      check('the first player is on the Rapier mover', r.mover[0] === 'rapier' && r.mover[1], r.mover.join());
      check('it walks the ground floor of the house', r.house.at[0] > -3 && near(r.house.at[1], 0, 0.2), JSON.stringify(r.house));
      check('it walks the cellar on under the lake, dry', r.cellar.at[0] > 11 && near(r.cellar.at[1], -4, 0.2) && r.cellarWater === -Infinity && r.swims.length === 0, JSON.stringify([r.cellar, r.cellarWater, r.swims]));
      check('off the pier it swims at the surface', r.lake.state === 'swim' && near(r.lake.at[1], -1.4, 0.1), JSON.stringify(r.lake));
      check('moved from the lake into the cellar under it, it stands on the cellar floor', near(r.moved.at[1], -4, 0.2) && !r.moved.swimming, JSON.stringify(r.moved));
      check('a body in the lake floats', r.bodies.lake.wet && r.bodies.lake.y > -1 && r.bodies.lake.y < 0, JSON.stringify(r.bodies.lake));
      check('a body in the cellar under it rests on the floor, dry, with its own damping', near(r.bodies.cellar.y, -3.75, 0.05) && !r.bodies.cellar.wet && r.bodies.cellar.damping < 1, JSON.stringify(r.bodies.cellar));
      check('a body in plain water floats at its level', r.bodies.pool.wet && r.bodies.pool.y > 2.4 && r.bodies.pool.y < 3.4, JSON.stringify(r.bodies.pool));
      check('in plain water the Rapier mover swims at the level', r.pool.state === 'swim' && near(r.pool.at[1], r.pool.want, 0.1), JSON.stringify(r.pool));
      check('with the plain water gone the body lands on the yard, dry again', near(r.poolGone.box.y, r.poolGone.yard + 0.25, 0.3) && !r.poolGone.box.wet, JSON.stringify(r.poolGone));
      check('and the player stands on the yard: the terrain under the level part is not solid', near(r.poolGone.at[1], r.poolGone.ground, 0.15), JSON.stringify(r.poolGone));
      check('outside the level part the terrain is solid', near(r.hill.at[1], r.hill.ground, 0.15), JSON.stringify(r.hill));
      check('when the water goes it stops swimming and stays a number', !r.drained.swimming && r.drained.at.every(Number.isFinite), JSON.stringify(r.drained));
    },
  },
];
