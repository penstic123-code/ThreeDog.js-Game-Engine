// Vegetation: the wheat field. Tufts grow only on the ground type 'wheat' (main.js groundType), so the field's edge is the terrain's, not a list
// of positions. rule cannot hold functions (it is sent to a worker thread).
export default {
  wheat: {
    model: 'wheatTuft', wind: 0.04, castShadow: true,
    rule: { perChunk: 9000, cluster: 'none', scale: [1.1, 1.4], stretch: [0.9, 1.15], sink: 0.02, biomes: { wheat: 1 }, avoidFlat: false },
  },
};
