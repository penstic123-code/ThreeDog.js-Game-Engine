// How sounds play, as content data (no functions, no paths). 'blip' is a tiny synth main.js registers as a sound asset (assets.manifest({ sounds }));
// a game with files names its asset-pack sounds the same way ({ hit: ['hit-1', 'hit-2'] }).
export default {
  sounds: {
    hit: { src: 'blip', params: { freq: 660 } },
    hurt: { src: 'blip', params: { freq: 170 } },
    kill: { src: 'blip', params: { freq: 990 } },
  },
};
