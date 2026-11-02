// Condition/effect words and data kinds this game adds (built-in words are in packages/engine/modules/content/rules.js). Registered automatically on content.load; the validator and game map read this too.
// ref is how the value is written: 'clock' means 'HH:MM', and test receives the fraction of the day 0-1.
const SHAPES = ['crate', 'ball', 'barrel'];

export default {
  conditions: {
    timeAfter: { ref: 'clock', desc: 'the day has passed this clock time', describe: v => `after ${v}`, test: (e, t) => (e.calendar?.timeOfDay ?? 0) >= t },
  },
  kinds: {
    bodies: {
      desc: 'physics props (id -> { shape: crate | ball | barrel, place, x, z, float? }): world records of kind body, given a rigid body in main.js',
      // authored world data: initial records, so a save keeps only what play changed (a pushed crate's position)
      load: (e, data, api) => {
        for (const [id, b] of Object.entries(data)) {
          const { x, z } = api.where(b), ground = e.surface(x, z);
          const y = b.float ? Math.max(ground, e.waterLevel ?? ground) + 1.5 : ground + 0.45;
          e.world.add({ id, kind: 'body', shape: b.shape, position: { x, y, z } }, { initial: true });
        }
      },
      check: (data, { err }) => { for (const [id, b] of Object.entries(data)) if (!SHAPES.includes(b?.shape)) err(`body ${id}: shape must be one of ${SHAPES.join(', ')}`); },
    },
  },
};
