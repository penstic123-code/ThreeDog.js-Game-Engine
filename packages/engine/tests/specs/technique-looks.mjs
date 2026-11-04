// examples/techniques/three-looks (page /technique-looks.html): the same models in three scenes, measured on pixels, so a look that stops working fails here.
// The suite reaches WebGPURenderer's WebGL2 backend; real-webgpu.mjs runs the same checks on the device.
// the world is built (engine.ready) and the renderer's device is up (later on a real GPU than on the fallback)
const ready = page => page.waitForFunction(() => window.techTest && window.engine.ready && window.engine.renderer._initialized, null, { timeout: 40000 });

export const specs = [
  {
    software: true,   // reads rendered pixels
    name: '[guard] technique three-looks: the same models read as three different pictures, the comic holds only its inks, tone mapping runs once',
    url: '/technique-looks.html?look=cartoon&threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const look = {};
      look.cartoon = await ev(() => window.techTest.measure());
      for (const name of ['comic', 'cinematic']) {
        await page.goto(page.url().replace(/look=\w+/, `look=${name}`));
        await ready(page);
        look[name] = await ev(() => window.techTest.measure());
      }
      console.log('  three looks numbers:', JSON.stringify(look));
      const { cartoon, comic, cinematic } = look;
      check('cartoon: flat bands, the 8 most common colors cover most of the picture', cartoon.top8 > 0.6, JSON.stringify(cartoon));
      check('comic: only its three inks, the 3 most common colors cover 99% of the picture', comic.top3 > 0.99, JSON.stringify(comic));
      check('comic: nearly no saturation (the paper tone is all there is) against cartoon', comic.saturation < cartoon.saturation / 5, JSON.stringify(look));
      check('comic: a wider light-dark spread than cartoon', comic.lumStd > cartoon.lumStd * 1.5, JSON.stringify(look));
      check('cinematic: smooth tones, far more distinct colors than cartoon, the 8 most common cover little', cinematic.colors > cartoon.colors * 2 && cinematic.top8 < cartoon.top8 / 2, JSON.stringify(look));
      check('cinematic: the darkest and the warmest of the three', cinematic.meanLum < cartoon.meanLum / 1.5 && cinematic.warmth > cartoon.warmth && cinematic.warmth > comic.warmth, JSON.stringify(look));
      // the page is on cinematic: ACES on. A neutral lut in the chain against no post at all: tone mapping applied twice would darken and flatten the picture
      const once = await ev(async () => {
        const { engine, techTest } = window, post = engine.post;
        for (const n of ['bloom', 'vignette', 'grain']) post.get(n).enabled = false;
        post.get('lut').set({ temperature: 0, saturation: 1, contrast: 1 });
        const chain = techTest.measure();
        post.get('lut').enabled = false;
        // one read right after the switch: the very next frame must already be the right picture (a frame late would show here)
        const direct = techTest.measure();
        return { chain, direct, first: direct.colors, active: post.active };
      });
      check('a neutral ldr lut leaves the tone-mapped picture as it is straight to the canvas (mean luminance within 1%)',
        Math.abs(once.chain.meanLum - once.direct.meanLum) < 0.01 * once.direct.meanLum, JSON.stringify(once));
      check('the first frame after the switch is already the full picture (many distinct colors, not a blank or half-drawn one)', once.first > cartoon.colors * 2, JSON.stringify(once));
      check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
