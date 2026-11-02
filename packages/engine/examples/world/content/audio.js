// How this game's sounds play, as content data (content.load reads the audio table): sounds are the game's, not the style's. Each rule names
// a sound asset (engine.assets.manifest({ sounds }): a file or a synth; the engine modules' own synths are registered under their names); anything omitted is silent.
// Data only, so no functions: conditions compare measures (daylight from sky, rain / snow / wind from weather, nearWater / altitude from ambience).
const step = surface => ({ src: 'footstep', params: { surface } });

export default {
  sounds: {
    // footsteps per surface (built-in footstep synth); a file version: 'step.grass': ['grass-1', 'grass-2'] (asset pack sound names)
    'step.grass': step('grass'), 'step.sand': step('sand'), 'step.rock': step('rock'), 'step.snow': step('snow'), 'step.water': step('water'),
    shutter: {}, thunder: {},   // built-in synth assets of photo() / weather(), played with default rules
    wind: {}, rain: {}, water: {}, birds: {}, crickets: {},   // ambience synths (ambience() module)
  },
  // Ambience rule table: while `when` holds the sound plays at `volume`; `every` makes it a one-shot at random gaps
  ambience: [
    // stronger with wind and higher up: 0.15 more at 40 m above sea level (altitude factor 0.15 / 40)
    { sound: 'wind', volume: { base: 0.05, add: { wind: 0.08, altitude: 0.00375 }, max: 0.5 }, fade: 0.8 },
    { sound: 'rain', volume: { add: { rain: 0.22 } } },   // volume 0 = off: the loop fades out and stops
    { sound: 'water', volume: { add: { nearWater: 0.12 } } },
    { sound: 'birds', when: { daylight: { gt: 0.15 }, rain: { lt: 0.2 } }, every: [1.5, 6.5] },
    { sound: 'crickets', when: { daylight: { lt: 0.05 }, rain: { lt: 0.2 }, snow: { lt: 0.2 } }, every: [0.4, 1.6] },
  ],
  // Ground type (terrainPreset biome names) -> footstep sound; water while swimming; default for anything else
  footsteps: { beach: 'step.sand', rock: 'step.rock', snow: 'step.snow', water: 'step.water', default: 'step.grass' },
  // Background music (asset pack sound names): music: { tracks: { day: 'music-day' }, rules: [{ track: 'night', when: { time: 'night' } }, { track: 'day' }] }
};
