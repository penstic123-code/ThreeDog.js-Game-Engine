// The game's sounds and the ambience rule table, as data (recipes/31-audio.md). 'synth' = the engine's synthesized sound; any other string
// is a sound name from an asset pack (engine.assets.manifest({ sounds: { door: '/sfx/door.ogg' } })), never a file path or a function.
export default {
  sounds: { footstep: 'synth', wind: 'synth', birds: 'synth' },
  ambience: [
    { sound: 'wind', volume: 0.12 },   // louder with the wind: volume: { base: 0.05, add: { wind: 0.07 } } (weather() gives the wind measure)
    { sound: 'birds', when: { time: 'day' }, every: [2, 7] },   // quiet in the rain: when: { time: 'day', rain: { lt: 0.2 } }
  ],
};
