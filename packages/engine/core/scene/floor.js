// The one height tolerance of walking. Everything that asks "is this the same floor" uses it (nav.point, arrival, passing path points, A*, NPC avoidance), so a floor
// can't count as near for one system and far for another. Its own file with no imports because the path worker needs it, and movement.js brings in the option checks.

/** Two heights are one floor when a body standing at one would reach the other. body: engine.movement.height */
export const sameFloor = (a, b, body) => Math.abs(a - b) <= body;

/**
 * Which of a spot's layers below its top a walker comes to: the highest not above lim (its height plus a step), else the lowest, so a cave with only a ceiling overhead still has a floor.
 * The ground (level heightfield) and the path worker's snapshot of it both choose with this, so a floor can't be one height to the search and another to the walker.
 * @param {{ y: number }[]} layers
 * @param {number} lim
 */
export function layerUnder(layers, lim) {
  let best = null, low = layers[0];
  for (const l of layers) { if (l.y <= lim && !(best?.y >= l.y)) best = l; if (l.y < low.y) low = l; }
  return best ?? low;
}
