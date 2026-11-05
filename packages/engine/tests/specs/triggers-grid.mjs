// Trigger zones on a spatial grid: same enter / exit sequence as visiting every zone, cheap with thousands of zones, and still right when zones are added / removed,
// sit on a cell border, carry their own `who` or cool down. Same format as the other files here; runs on the small town page (engine.triggers, no terrain).
export const specs = [
  {
    name: 'triggers grid: 2000 zones give the same enter / exit sequence as a full scan, each step is cheap, 120000 zones do not overflow the stack (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const T = engine.triggers, P = engine.player.position, own = T.list().length;   // the town page has zones of its own
        let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        const log = [], offs = [
          engine.events.on('trigger:enter', d => log.push('+' + d.tag)),
          engine.events.on('trigger:exit', d => log.push('-' + d.tag))];
        const zs = [];
        for (let i = 0; i < 2000; i++) {
          const shape = ['sphere', 'box', 'cylinder'][i % 3];
          zs.push(T.add({ shape, position: { x: rnd() * 400 - 200, y: -1, z: rnd() * 400 - 200 }, radius: 1 + rnd() * 6, size: [1 + rnd() * 12, 6, 1 + rnd() * 12], rotation: rnd() * 6, height: 6, tag: 'z' + i }));
        }
        zs.push(T.add({ shape: 'box', position: { x: 0, y: -1, z: 0 }, size: [300, 6, 4], tag: 'wide' }));   // too large for the grid: always-checked path
        // reference: every step visit every zone newest first, exactly what the module did before the grid
        const want = [], was = new Set();
        const path = Array.from({ length: 500 }, (_, i) => [Math.cos(i / 40) * 150 + rnd() * 3, Math.sin(i / 25) * 150 + rnd() * 3]);
        let stepMs = 0, visited = 0;
        for (const [x, z] of path) {
          P.set(x, 0, z);
          const p = engine.actorPosition();
          for (let i = zs.length - 1; i >= 0; i--) {
            const t = zs[i], hit = t.contains(p);
            if (hit && !was.has(t)) { was.add(t); want.push('+' + t.tag); } else if (!hit && was.has(t)) { was.delete(t); want.push('-' + t.tag); }
          }
          const t0 = performance.now(); T.update(1 / 60); stepMs += performance.now() - t0;
          visited += T._scan.length;   // zones this step actually tested (the work the grid saves); timings are printed only, they flake under load
        }
        const same = log.length === want.length && log.every((s, i) => s === want[i]);
        // timing on the same positions: visiting every zone, as the old update did
        let scanMs = 0, hits = 0;
        { const t0 = performance.now(); for (const [x, z] of path) { P.set(x, 0, z); const p = engine.actorPosition(); for (let i = zs.length - 1; i >= 0; i--) if (zs[i].contains(p)) hits++; } scanMs = performance.now() - t0; }
        for (const z of zs) z.remove();
        offs.forEach(o => o?.remove?.());
        // 120000 zones: the old update spread the whole list into push(...), which overflows the call stack around 100k
        let big = null; try {
          const hs = []; for (let i = 0; i < 120000; i++) hs.push(T.add({ position: { x: (i % 400) * 3, y: 0, z: Math.floor(i / 400) * 3 }, radius: 1 }));
          const t0 = performance.now(); T.update(1 / 60); big = { ms: Math.round(performance.now() - t0) };
          for (let i = hs.length - 1; i >= 0; i--) hs[i].remove();
        } catch (e) { big = { error: String(e) }; }
        return { same, n: log.length, stepMs: stepMs / path.length, scanMs: scanMs / path.length, visited: visited / path.length, total: zs.length + own, hits, big, left: T.list().length - own };
      });
      console.log(`  triggers: 2000 zones module ${r.stepMs.toFixed(4)} ms/step (${r.visited.toFixed(1)} zones tested), full scan ${r.scanMs.toFixed(4)} ms/step, ${r.n} events, 120000 zones first step ${r.big.ms} ms`);
      check('enter / exit sequence over 500 steps equals the full scan', r.same && r.n > 20, `${r.n} events`);
      // counted, not timed: the grid's point is testing the zones near the actor (plus always-checked and occupied ones), not all of them
      check('a step with 2000 zones tests under a twentieth of them', r.visited > 0 && r.visited < r.total / 20, `${r.visited.toFixed(1)} of ${r.total} zones per step`);
      check('120000 zones: update runs without a stack overflow', r.big && !r.big.error, JSON.stringify(r.big));
      check('removing everything leaves nothing behind', r.left === 0, r.left);
    },
  },
  {
    name: 'triggers grid: add / remove while playing, zones on a cell border, rotated boxes, custom who, cooldown and callbacks that remove zones (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const T = engine.triggers, P = engine.player.position, log = [], out = {};
        const offs = [engine.events.on('trigger:enter', d => log.push('+' + d.tag)), engine.events.on('trigger:exit', d => log.push('-' + d.tag + (d.who ? '' : '!')))];
        const go = (x, z, steps = 1) => { P.set(x, 0, z); for (let i = 0; i < steps; i++) T.update(0.1); };
        const take = () => log.splice(0).join(' ');
        const height = engine.ground.height; engine.ground.height = () => -Infinity;   // off a shaped terrain's outline
        const offIsland = T.add({ position: { x: 1, z: 1 } }); out.offGroundY = offIsland.y; offIsland.remove(); engine.ground.height = height;
        go(500, 500);
        // added next to the actor after it stood still: found at once; removed while occupied: exit with who = null
        const a = T.add({ position: { x: 500, y: -1, z: 500 }, radius: 2, tag: 'a' });
        go(500, 500); out.add = take();
        a.remove(); out.remove = take();
        go(500, 500); out.afterRemove = take();
        // a point exactly on the zone's edge and on a 16 m cell border counts, as contains() says
        const e = T.add({ shape: 'sphere', position: { x: 32, y: 0, z: 32 }, radius: 4, tag: 'edge' });
        go(36, 32); out.edge = take() + (e.contains({ x: 36, y: 0, z: 32 }) ? ' contains' : '');
        go(36.001, 32); out.edgeOut = take(); e.remove();
        // a rotated box whose far corner reaches into a neighbouring cell: (107, 93) is 9.9 m along its long axis
        const b = T.add({ shape: 'box', position: { x: 100, y: -1, z: 100 }, size: [20, 6, 2], rotation: Math.PI / 4, tag: 'rot' });
        go(107, 93); out.rot = take(); b.remove(); take();
        // custom who: a function and an object, far from the actor
        const mover = { x: 300, y: 0, z: 300 }, tf = T.add({ position: { x: 300, y: -1, z: 300 }, radius: 2, tag: 'fn', who: () => [mover] });
        const obj = { isObject3D: true, position: { x: -300, y: 0, z: -300 } }, to = T.add({ position: { x: -300, y: -1, z: -300 }, radius: 2, tag: 'obj', who: obj });
        go(500, 500); out.who = take();
        mover.x = 400; go(500, 500); out.whoOut = take(); tf.remove(); to.remove(); take();
        // cooldown keeps counting while the actor is far away, then the zone fires again on return
        const c = T.add({ position: { x: 600, y: -1, z: 600 }, radius: 2, tag: 'cool', cooldown: 0.35 });
        go(600, 600); go(700, 700); out.coolA = take();
        go(600, 600); out.coolB = take();         // still cooling: no enter
        go(700, 700, 5); go(600, 600); out.coolC = take(); c.remove(); take();
        // once and enabled
        const o = T.add({ position: { x: 800, y: -1, z: 800 }, radius: 2, tag: 'once', once: true });
        go(800, 800, 2); out.once = take(); go(900, 900); go(800, 800); out.onceAgain = take(); o.remove();
        const d = T.add({ position: { x: 800, y: -1, z: 800 }, radius: 2, tag: 'dis', enabled: false });
        go(800, 800); out.dis = take(); d.enabled = true; go(800, 800); out.en = take(); d.enabled = false; go(800, 800); out.disExit = take(); d.remove();
        // a callback that removes a zone already visited this step and adds a new one: nothing runs twice, the new zone starts next step
        let n1 = 0, n2 = 0; let z2;
        T.add({ position: { x: 1000, y: -1, z: 1000 }, radius: 2, tag: 'z1', onEnter: () => { n1++; z2.remove(); T.add({ position: { x: 1000, y: -1, z: 1000 }, radius: 2, tag: 'z3' }); } });
        z2 = T.add({ position: { x: 1000, y: -1, z: 1000 }, radius: 2, tag: 'z2', onEnter: () => n2++ });   // newest first: z2 runs before z1
        go(1000, 1000); out.cb = take() + ` n1=${n1} n2=${n2}`; go(1000, 1000); out.cb2 = take();
        for (const t of T.list()) t.remove();
        take(); offs.forEach(o2 => o2?.remove?.());
        return out;
      });
      check('zone added beside a standing actor enters at once; removing it exits with who = null', r.add === '+a' && r.remove === '-a!' && r.afterRemove === '', JSON.stringify([r.add, r.remove, r.afterRemove]));
      check('a zone placed off the ground gets a finite height', Number.isFinite(r.offGroundY), r.offGroundY);
      check('edge of a zone on a cell border still counts', r.edge === '+edge contains' && r.edgeOut === '-edge!', JSON.stringify([r.edge, r.edgeOut]));
      check('rotated box reaching into a neighbouring cell', r.rot === '+rot', r.rot);
      check('function / object who: zones fire far from the actor and leave again', r.who === '+obj +fn' && r.whoOut === '-fn!', JSON.stringify([r.who, r.whoOut]));
      check('cooldown runs while away: no enter at once, enter after it elapsed', r.coolA === '+cool -cool!' && r.coolB === '' && r.coolC === '+cool', JSON.stringify([r.coolA, r.coolB, r.coolC]));
      check('once fires a single time; disabled zones do not fire, and exit when disabled while occupied', r.once === '+once -once!' && r.onceAgain === '' && r.dis === '' && r.en === '+dis' && r.disExit === '-dis!', JSON.stringify([r.once, r.onceAgain, r.dis, r.en, r.disExit]));
      check('callback removing / adding zones: nothing runs twice', r.cb === '+z2 -z2! +z1 n1=1 n2=1' && r.cb2 === '+z3', JSON.stringify([r.cb, r.cb2]));
    },
  },
];
