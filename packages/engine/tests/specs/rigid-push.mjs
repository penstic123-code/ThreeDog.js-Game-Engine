// Can the player push a rigid body by walking into it? Recipe 11 §3 "Pushing bodies with the player" answers yes, with any mover; this proves it.
// Why a test and not only the doc sentence: the answer comes from how two parts meet (rigid keeps a kinematic capsule on the player every step,
// the 'rapier' mover leaves dynamic bodies out of its own collision), and a change to either would silently turn "walk into the crate" into
// "walk through it" or "stop at it". Vehicle test page (flat ground, rigid installed); ?mover=rapier switches the character mover.
const READY = { timeout: 60000 };

// Inside the page: walk on autopilot to learn the walking direction, put a 1 m crate 1.5 m ahead on that line, walk 3 s more, report how far the
// crate moved along the walk and where the player ended up relative to it (pushed ahead = crate stays in front, moved forward)
async function walkIntoCrate() {
  const e = window.engine, R = e.rigid, T = __threedogThree;
  e.haltLoop();
  e.input.autopilot = { x: 0, y: 1, speed: 1 };
  const p0 = e.player.position.clone();
  e.step(0.5, { render: false, describe: false });
  const d = e.player.position.clone().sub(p0).setY(0);
  if (d.length() < 0.2) return { error: 'autopilot did not move the player', moved: d.length() };
  d.normalize();
  const p = e.player.position, at = new T.Vector3(p.x + d.x * 1.5, 0.5, p.z + d.z * 1.5);
  const crate = R.addBox(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()), { size: [1, 1, 1], mass: 2 });
  R.setPosition(crate, [at.x, at.y, at.z]); crate.mesh.position.copy(at);
  e.step(3, { render: false, describe: false });
  const t = crate.body.translation(), c = new T.Vector3(t.x, t.y, t.z);
  const along = c.clone().sub(at).dot(d);
  const playerAhead = e.player.position.clone().sub(c).dot(d);   // > 0: the player is past the crate (walked through it)
  e.input.autopilot = null;
  return { along, playerAhead, crateY: t.y };
}

const run = async ({ check, ev }) => {
  const r = await ev(walkIntoCrate);
  check('the player walked', !r.error, JSON.stringify(r));
  check('walking into a dynamic crate pushes it forward (more than 1 m along the walk)', r.along > 1, JSON.stringify(r));
  check('the crate stays in front of the player (pushed, not walked through)', r.playerAhead < 0, JSON.stringify(r));
};

export const specs = [
  { name: '[guard] rigid push: the player walking into a crate pushes it (simple mover)', url: '/tests/vehicle/index.html', timeout: 90000,
    async run(ctx) { await ctx.page.waitForFunction(() => window.engine?.ready && window.engine.rigid?.ready, null, READY); await run(ctx); } },
  { name: '[guard] rigid push: the player walking into a crate pushes it (rapier mover)', url: '/tests/vehicle/index.html?mover=rapier', timeout: 90000,
    async run(ctx) { await ctx.page.waitForFunction(() => window.engine?.ready && window.engine.rigid?.ready, null, READY); await run(ctx); } },
  { name: '[guard] rigid: a body under a moved parent registers at the world pose and writes back through the parent; a sheared parent is refused by name', url: '/tests/vehicle/index.html', timeout: 90000,
    async run({ check, ev, page }) {
      await page.waitForFunction(() => window.engine?.ready && window.engine.rigid?.ready, null, READY);
      const r = await ev(() => {
        const e = window.engine, R = e.rigid, T = __threedogThree;
        e.haltLoop();
        const parent = new T.Group(); parent.position.set(10, 20, 0); parent.rotation.y = Math.PI / 2; e.add(parent);
        const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); mesh.position.set(1, 0, 0); parent.add(mesh);
        const b = R.addBox(mesh, { size: [1, 1, 1], mass: 1 });
        const t = b.body.translation(), out = { world: [t.x, t.y, t.z] };
        e.step(0.5, { render: false, describe: false });
        const w = new T.Vector3(); mesh.getWorldPosition(w); const t2 = b.body.translation();
        out.drawnMinusBody = Math.hypot(w.x - t2.x, w.y - t2.y, w.z - t2.z);
        const bad = new T.Group(); bad.scale.set(1, 2, 1); e.add(bad);
        const m2 = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); bad.add(m2);
        try { R.addBox(m2, { size: [1, 1, 1] }); out.refused = 'no throw'; } catch (err) { out.refused = err.message; }
        return out;
      });
      check('body is created at the world position (10, 20, -1), not the local (1, 0, 0)', Math.abs(r.world[0] - 10) < 1e-3 && Math.abs(r.world[1] - 20) < 1e-3 && Math.abs(r.world[2] + 1) < 1e-3, JSON.stringify(r.world));
      check('after stepping, the mesh still draws where the body is', r.drawnMinusBody < 1e-2, JSON.stringify(r));
      check('a parent scaled differently per axis is refused, naming the parent', /rigid/.test(r.refused) && /differs between axes/.test(r.refused), r.refused);
    } },
];
