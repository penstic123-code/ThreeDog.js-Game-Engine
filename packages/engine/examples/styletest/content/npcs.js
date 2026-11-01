// One character for the close-up view: wander with radius 0 keeps it standing where it starts (a behavior without a schedule).
export default {
  guide: {
    name: 'Guide',
    model: 'humanoid', colors: { body: 0x4f6d8f, legs: 0x5b4a3a, hair: 0xd8d4cc },
    start: { place: 'stage', x: 2.5, z: 4 }, behavior: 'wander', mind: { radius: 0 },
  },
};
