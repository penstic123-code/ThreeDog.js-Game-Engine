// The three.js layers the engine keeps for itself, in one table: every user imports it, so two systems can never claim the same number. Its own subpath (threedog/layers) because
// @threedog/post-effects uses it too and needs no more of the engine than this. A game's own layers are 1 to 25; 30 is the default camera hideLayer, which a game can change.
export const RESERVED_LAYERS = Object.freeze({
  /** lightVolumes' box of air and the point and spot lights it reads: only its small pass looks here */
  lightVolumes: 26,
  /** occlusion culling's query boxes: only the view camera sees them, so voxel GI, probes and shadows never take them for geometry */
  occlusionBox: 27,
  /** nothing sits here: occlusion culling sets it on shadow cameras so three reads their own layers, not the view camera's, and what it hides still casts */
  occlusionHidden: 28,
  /** objects outline({ offLayer }) leaves without lines */
  outlineOff: 29,
  /** originals drawn through engine.batching, standing behind a far hlod proxy, or the full model of a far assets.lod: not drawn, not in shadows, still hit by engine.rays */
  batched: 31,
});
