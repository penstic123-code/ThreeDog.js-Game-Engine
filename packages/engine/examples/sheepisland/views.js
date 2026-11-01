// Named camera positions of the sheep island. Same name = same framing every time, so two screenshots differ only by time, weather or style.
// The island is centred on (0, 0) and is about 60 m across; positions are [x, y, z] in world space.
export const VIEWS = {
  overview: { pos: [0, 36, 48], look: [0, -1, 0] },        // the whole island floating on the backdrop, from the south, a little above
  flock: { pos: [4, 7, 26], look: [-5, 1, 13] },          // the sheep, the river behind them
  field: { pos: [26, 12, 6], look: [13, 1, -12] },        // the wheat field and the trees beyond
  river: { pos: [-4, 12, 9], look: [-6, 1, 0] },          // the river banks from above: how crisp the ground-type border is
  rim: { pos: [-30, 5, 30], look: [-20, 0, 16] },         // the ragged rim and the wall under it, seen from just above the edge
};
