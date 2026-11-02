// Vegetation: name -> model (an asset name from the asset pack in ../style/; use an array for parameters) and growth rule.
// rule.biomes lists the biomes it grows in, values are spawn probabilities; rule cannot hold functions (it is sent to a worker thread).
// Note: main.js tree chopping uses these names (松树, 圆树); after changing rules or density, trees chopped in old saves map to different trees.
export default {
  松树: {
    model: 'pine', lod: 'pineLow', wind: 0.022,
    rule: { perChunk: 130, minHeight: 1.6, maxHeight: 40, maxSlope: 0.6, cluster: 'forest', scale: [0.75, 1.6], stretch: [0.85, 1.2], sink: 0.15,
      biomes: { forest: 1, meadow: 0.35, snow: 0.6, wetland: 0.3, riverbank: 0.3 }, collider: 0.35,
      tints: [{ color: [1.35, 1.05, 0.55], chance: 0.06 }] },
  },
  圆树: {
    model: 'roundTree', lod: 'roundTreeLow', wind: 0.03,
    rule: { perChunk: 50, minHeight: 1.6, maxHeight: 22, maxSlope: 0.45, scale: [0.8, 1.3], collider: 0.3,
      biomes: { meadow: 0.8, savanna: 0.35, riverbank: 0.9, forest: 0.3 },
      tints: [{ color: [1.4, 1.0, 0.5], chance: 0.15 }] },
  },
  石头: {
    model: 'rock', maxRing: 3,
    rule: { perChunk: 14, chance: 0.6, minHeight: 0.5, maxHeight: 70, maxSlope: 2, scale: [0.4, 1.6], stretch: [0.5, 0.8], sink: 0.2, tintJitter: 0.15, collider: 0.6 },
  },
  草: {
    model: 'grass', nearOnly: true, maxRing: 1, wind: 0.3,
    rule: { perChunk: 1800, chance: 0.75, minHeight: 1.4, maxHeight: 20, maxSlope: 0.42, scale: [0.7, 1.4], sink: 0.05, avoidFlat: false,
      biomes: { meadow: 1, forest: 0.6, riverbank: 1, wetland: 1, savanna: 0.8 } },
  },
  野花: {
    model: ['flower', 0xf2d16b], nearOnly: true, maxRing: 1, wind: 0.25,
    rule: { perChunk: 260, minHeight: 1.5, maxHeight: 14, maxSlope: 0.35, scale: [0.8, 1.3], sink: 0,
      biomes: { meadow: 1, riverbank: 0.6 },
      tints: [{ color: [1.6, 0.6, 0.7], chance: 0.35 }, { color: [0.8, 0.9, 1.6], chance: 0.25 }] },
  },
};
