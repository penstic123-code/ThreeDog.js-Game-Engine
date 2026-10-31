// NPCs: in a schedule, at is a clock time ('06:00'); at that time the NPC walks to the spot. talk is a dialogue id (dialogues.js).
export default {
  fisher: {
    name: '老渔夫',
    colors: { body: 0x4f6d8f, legs: 0x5b4a3a, hair: 0xd8d4cc },
    start: { place: 'home', x: 1, z: 5 },
    schedule: [
      { at: '06:00', place: 'river' },             // go to the riverside
      { at: '12:00', place: 'home', x: -4, z: 4 },  // go home
      { at: '19:12', place: 'home', x: 1, z: 4.5 }, // sit at the doorway
    ],
    talk: 'fisher',
  },
};
