// [guard] Three look routes that were missing (docs/plans/2026-11-03-slot-map.md section 7): the cloud shadow and the season / snow tint
// can be replaced whole by the game (route c), the vegetation look takes a color hook (route b), each on WebGL and on WebGPU.
// Why a guard: a route that exists only on one backend, or that reaches only materials made after the call, looks done in the docs and
// does nothing in a game whose terrain and trees were built at start.
export const specs = [
  {
    name: '[guard] look no-bypass routes: cloud shadow and season replace, vegetation color patch, on WebGL and WebGPU',
    url: '/tests/engine-webgpu/index.html',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.lookRoutes());
      console.log('  look routes numbers:', JSON.stringify(r));
      for (const side of ['gl', 'gpu']) {
        const o = r[side];
        check(`${side}: look.cloudShadow.replace({ glsl, tsl }) changes the built terrain and trees, owner on describe().look; false drops the term; removing gives it back`,
          o.cloud.moved > 3 && o.cloud.writer === 'game:mine' && o.cloud.on > 0 && o.cloudOff === 0 && o.cloudBack.on > 0 && o.cloudBack.moved < 0.5, JSON.stringify([o.cloud, o.cloudOff, o.cloudBack]));
        check(`${side}: look.season.replace(kind => spec) recolors ground and foliage already built; removing gives the engine tint back`,
          o.season.moved > 3 && o.season.writer === 'game:mine' && o.season.on > 0 && o.seasonBack < 0.5, JSON.stringify([o.season, o.seasonBack]));
        check(`${side}: look.vegetation.patch('color') recolors the planted trees live; removing takes the patch off`,
          o.veg.moved > 0.3 && o.veg.writer === 'game:mine' && o.veg.on > 0 && o.vegBack.on === 0 && o.vegBack.moved < 0.5, JSON.stringify([o.veg, o.vegBack]));
        check(`${side}: a spec missing the form this renderer draws is named, not drawn as nothing`,
          o.named.every(m => /cannot draw/.test(m)), JSON.stringify(o.named));
      }
    },
  },
];
