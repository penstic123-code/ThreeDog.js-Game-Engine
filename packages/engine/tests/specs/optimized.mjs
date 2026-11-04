// A model made by `threedog assets optimize` (fixtures/optimized-crate.glb: Meshopt + KTX2, color ETC1S sRGB, normal UASTC linear) loads and draws on both renderers, and
// the two agree on what is measurable: size, mip count, color space, and the mean color of the picture (the transcoded block format may differ per device, so it is only printed).
// `node packages/tools/real-webgpu.mjs r=gpu` runs the WebGPU one on real WebGPU.
const run = async ({ page, check, ev }) => {
  await page.waitForFunction(() => window.ready, null, { timeout: 60000 });
  const r = await ev(() => window.optimizedRun());
  console.log('  optimized numbers:', JSON.stringify(r));
  check('the KTX2 loader started and both textures are compressed textures', r.ktx2Loader && r.map?.compressed && r.normalMap?.compressed, JSON.stringify(r));
  check('textures keep their size (128 x 128) and a full mip chain', r.map.w === 128 && r.map.h === 128 && r.normalMap.w === 128 && r.map.mips === 8 && r.normalMap.mips === 8, JSON.stringify([r.map, r.normalMap]));
  check('color space: the color map is sRGB, the normal map is not', r.map.colorSpace === 'srgb' && r.normalMap.colorSpace !== 'srgb', JSON.stringify([r.map.colorSpace, r.normalMap.colorSpace]));
  // Both renderers measured the same mean color [42, 42, 38] (the quad lit by the ambient light, the transcoded gradient in the middle); the background there would be about [32, 48, 64].
  // A wrong decode (a normal map read as color, a color map read as linear) or no texture moves it; the tolerance covers the block format differing per device.
  check('the model is drawn with its textures and both renderers agree on the picture (mean color 42, 42, 38 +-8)', r.mean.every((v, i) => Math.abs(v - [42, 42, 38][i]) <= 8), JSON.stringify(r.mean));
};
export const specs = [
  { name: '[guard] optimized model (Meshopt + KTX2) loads and draws on WebGLRenderer', url: '/tests/optimized/index.html', software: true, run },
  { name: '[guard] optimized model (Meshopt + KTX2) loads and draws on WebGPURenderer', url: '/tests/optimized/index.html?r=gpu', software: true, run },
];
