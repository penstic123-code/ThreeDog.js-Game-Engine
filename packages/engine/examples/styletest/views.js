// Named camera positions of the style test. Same name = same framing every time, so two screenshots differ only by style.
// A view is a function of the stage (its flat spot) and the water point, both found at startup because terrain is procedural.
// Positions are [x, y, z] in world space; y is measured above the ground at the stage unless noted.

/** Path speed, meters per second: slow enough to see grass blades and shadow edges crawl or flicker */
export const PATH_SPEED = 2.5;

/** @param {{ x: number, z: number }} stage @param {{ x: number, z: number }} water @param {any} engine */
export function makeViews(engine, stage, water) {
  const h = engine.surface(stage.x, stage.z);
  const at = (dx, dy, dz) => [stage.x + dx, h + dy, stage.z + dz];
  const room = (dx, dy, dz) => at(14 + dx, dy, -2 + dz);   // room-local coordinates (the room stands at stage + (14, -2))
  // water: stand back from the water point on the stage side and look at the surface
  const wl = engine.waterLevel, dx = water.x - stage.x, dz = water.z - stage.z, len = Math.hypot(dx, dz) || 1;
  const bx = water.x - dx / len * 22, bz = water.z - dz / len * 22, eye = [bx, Math.max(engine.surface(bx, bz), wl) + 6, bz];
  const front = [[-12, 3.5, 15], [12, 3.5, 15]];   // the path: a straight line in front of the exhibits, looking at their middle
  return {
    overview: { pos: at(4, 12, 26), look: at(4, 1.5, -2) },
    character: { pos: at(5.2, 1.7, 7.4), look: at(2.5, 1.1, 4) },
    water: { pos: eye, look: [water.x, wl, water.z] },
    room: { pos: room(2.3, 1.6, -1.8), look: room(-1.5, 1.4, 2.4) },
    ui: { pos: at(4, 12, 26), look: at(4, 1.5, -2) },
    path: { pos: at(...front[0]), look: at(2, 1.2, -2), to: at(...front[1]), speed: PATH_SPEED },
  };
}

/** Where the path camera is `seconds` after it was chosen: back and forth along its line at constant speed (a triangle wave: no easing, no pauses at the ends) */
export function pathAt(v, seconds) {
  const len = Math.hypot(v.to[0] - v.pos[0], v.to[2] - v.pos[2]), s = (seconds * v.speed) % (2 * len), k = (s < len ? s : 2 * len - s) / len;
  return v.pos.map((a, i) => a + (v.to[i] - a) * k);
}
