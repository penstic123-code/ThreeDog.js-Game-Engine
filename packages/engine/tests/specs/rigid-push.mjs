// Can the player push a rigid body by walking into it? Recipe 11 §3 "Pushing bodies with the player" answers yes, with any mover; this proves it.
// Why a test and not only the doc sentence: the answer comes from how two parts meet (rigid keeps a kinematic capsule on the player every step,
// the 'rapier' mover leaves dynamic bodies out of its own collision), and a change to either would silently turn "walk into the crate" into
// "walk through it" or "stop at it". Vehicle test page (flat ground, rigid installed); ?mover=rapier switches the character mover.
const READY = { timeout: 60000 };

// Inside the page: walk on autopilot to learn the walking direction, put a 1 m crate 1.5 m ahead on that line, walk 3 s more, report how far the
// crate moved along the walk and where the player ended up relative to it (pushed ahead = crate stays in front, moved forward)
async function walkIntoCrate() {
  const e = window.engine, R = e.rigid, T = e.THREE;
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
];
