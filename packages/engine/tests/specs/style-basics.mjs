// Stylized NodeMaterials on pixels (tests/style-basics). The suite runs it on WebGPURenderer's WebGL2 backend, real-webgpu.mjs on the device.
// The first checks pin what three's toon does (red channel only, shadow wipes the ramp): the reason celLighting exists. When a three update changes them, delete celLighting.
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const blue = c => c[2] > c[0] + 20;

export const specs = [
  {
    software: true,   // reads rendered pixels
    name: '[guard] style basics: three toon reads red only, celLighting keeps colored flat bands with cast shadows in them, positionNode moves the shadow',
    url: '/tests/style-basics/index.html',
    async run({ check, ev }) {
      const r = await ev(() => window.styleBasics());
      console.log('  style basics numbers:', JSON.stringify(r));
      const s = v => JSON.stringify(v);
      check("three's toon: a colored ramp comes out gray (only its red channel is read)", r.toonColored.away[0] === r.toonColored.away[2], s(r.toonColored));
      check("three's toon: a cast shadow falls to ambient, the ramp's dark band never shows in it", lum(r.toonGray.shadow) < lum(r.celGray.shadow) - 30, s([r.toonGray, r.celGray]));
      check('celLighting, gray ramp: three flat bands on the ball', r.celGray.bands === 3, s(r.celGray));
      check('celLighting, colored ramp: three flat bands on the ball', r.celColored.bands === 3, s(r.celColored));
      check('celLighting, colored ramp: the side turned away and the cast shadow take the ramp color', blue(r.celColored.away) && blue(r.celColored.shadow), s(r.celColored));
      check('celLighting: a cast shadow stays visible against open ground', lum(r.celColored.shadow) < 0.8 * lum(r.celColored.open) && lum(r.celGray.shadow) < 0.8 * lum(r.celGray.open), s([r.celColored, r.celGray]));
      check('celLighting: an object with receiveShadow off reads no shadow (lighter on the side turned away)', lum(r.celNoReceive.away) > lum(r.celColored.away) + 20, s([r.celNoReceive, r.celColored]));
      check("celLighting without a gradientMap: three's two levels", r.celNoRamp.bands === 2, s(r.celNoRamp));
      check('celLighting with a point light: its cast shadow takes the ramp color too', lum(r.celPoint.shadow) < 0.8 * lum(r.celPoint.open) && blue(r.celPoint.shadow), s(r.celPoint));
      check('a caster moved only by positionNode takes its shadow along (no shadow setup of its own)', lum(r.casterMoved) > lum(r.casterStill) + 50, s([r.casterStill, r.casterMoved]));
    },
  },
];
