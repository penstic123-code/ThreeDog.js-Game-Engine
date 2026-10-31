// Sounds as content data (no functions, no paths). 'blip' is a tiny synth main.js registers (engine.audio.register); a game with files names
// asset-pack sounds here instead ({ hit: ['hit-1', 'hit-2'] }).
export default {
  sounds: {
    hit: { synth: 'blip', params: { freq: 660 } },
    hurt: { synth: 'blip', params: { freq: 170 } },
    kill: { synth: 'blip', params: { freq: 990 } },
  },
};
