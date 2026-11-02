// Procedural animation technique example (examples/techniques/procedural-animation, page /procanim.html). Drives the player with the input
// autopilot at two speeds, then stops: legs must swing while moving and faster with speed, settle to rest at idle, and nothing may drift
// (the body returns to its rest height, the character does not creep while idle). A cycle tied to time instead of distance, legs frozen
// mid-step, or a pose that accumulates per frame all fail here.

export const specs = [
  {
    name: 'procedural animation example: legs move with speed, stop at idle, no drift',
    url: '/procanim.html?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(() => { try {
        const { animator, parts, player } = window.procAnimTest, legs = parts.legs;
        engine.step(1);
        const rest = { bodyY: animator.describe().bodyY, legs: Object.values(legs).map(l => l.rotation.x) };
        // sample legs over 1 s of movement at a given speed: the swing range and how far the cycle advanced
        const move = speed => {
          engine.input.autopilot = { x: 0, y: 1, speed };
          engine.step(0.6);
          let lo = Infinity, hi = -Infinity, cycles = 0, last = animator.describe().phase, pairs = 0;
          for (let i = 0; i < 30; i++) {
            engine.step(1 / 30, { render: false, describe: false });
            const fl = legs.FL.rotation.x, fr = legs.FR.rotation.x;
            lo = Math.min(lo, fl); hi = Math.max(hi, fl); if (Math.sign(fl) !== Math.sign(fr)) pairs++;
            const p = animator.describe().phase; cycles += (p - last + 1) % 1; last = p;
          }
          return { range: hi - lo, cycles, opposite: pairs, moveAmount: player.moveAmount };
        };
        const walk = move(2), run = move(6);
        engine.input.autopilot = null;
        engine.step(2);
        const stopped = { x: player.root.position.x, z: player.root.position.z };
        engine.step(3);   // 5 s still in all: past the page's 4 s 'sit' threshold (the game's own state through the `states` hook)
        const idle = { legs: [legs.FL, legs.FR].map(l => l.rotation.x), bodyY: animator.describe().bodyY, bodyXZ: [parts.body.position.x, parts.body.position.z],
          dx: Math.hypot(player.root.position.x - stopped.x, player.root.position.z - stopped.z), state: player.state };
        return { rest, walk, run, idle };
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      const { rest, walk, run, idle } = r;
      check('at rest after loading, legs hang straight', rest.legs.every(a => Math.abs(a) < 0.02), JSON.stringify(rest));
      check('walking swings the legs (front-left range > 0.4 rad)', walk.range > 0.4, JSON.stringify(walk));
      check('front legs move out of step with each other while walking (gait offsets, not all in sync)', walk.opposite > 5, JSON.stringify(walk));
      check('running cycles faster than walking (the cycle follows distance)', run.cycles > walk.cycles * 1.5, JSON.stringify({ walk, run }));
      check('running swings wider than walking', run.range > walk.range, JSON.stringify({ walk, run }));
      check('idle after moving: front legs are back at rest (|angle| < 0.02 rad)', idle.legs.every(a => Math.abs(a) < 0.02), JSON.stringify(idle));
      check('no drift: the body is back at its rest height and centred', Math.abs(idle.bodyY - rest.bodyY) < 1e-3 && idle.bodyXZ.every(v => v === 0), JSON.stringify({ rest, idle }));
      check('no drift: the character does not creep while standing', idle.dx < 1e-3, JSON.stringify(idle));
      check("the game's own state from the character `states` hook reaches the pose code ('sit' after 4 s still)", idle.state === 'sit', JSON.stringify(idle));
    },
  },
];
