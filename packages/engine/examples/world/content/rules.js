// Condition/effect words this game adds (built-in words are in packages/engine/modules/content/rules.js). Registered automatically on content.load; the validator and game map read this too.
// ref is how the value is written: 'clock' means 'HH:MM', and test receives the fraction of the day 0-1.
export default {
  conditions: {
    timeAfter: { ref: 'clock', desc: 'the day has passed this clock time', describe: v => `after ${v}`, test: (e, t) => (e.sky?.timeOfDay ?? 0) >= t },
  },
};
