// The game's sounds and the ambience rule table, as data (recipes/31-audio.md). The manifest says what a sound is, these rules say how it plays.
// footstep / wind / birds are the engine modules' built-in synth assets, silent until a rule names them: {} plays the asset of the same name.
// A string or { src } names another sound asset (engine.assets.manifest({ sounds: { door: '/sfx/door.ogg', ding: synthFn } })), never a path or code.
export default {
  sounds: { footstep: {}, wind: {}, birds: {} },
  ambience: [
    { sound: 'wind', volume: 0.12 },   // louder with the wind: volume: { base: 0.05, add: { wind: 0.07 } } (weather() gives the wind measure)
    { sound: 'birds', when: { time: 'day' }, every: [2, 7] },   // quiet in the rain: when: { time: 'day', rain: { lt: 0.2 } }
  ],
};
