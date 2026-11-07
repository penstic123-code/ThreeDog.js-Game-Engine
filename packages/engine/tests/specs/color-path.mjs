// One colour, two roads: the same picture drawn straight and through the post chain. A second conversion or a lost tone map shows up here as a jump when an effect is switched.
export const specs = [{
  name: '[guard] colour path: background, opaque and transparent pixels hold their colour when a neutral effect turns the post chain on, under each tone map and exposure; depthWrite and draw order stay the game\'s',
  url: '/tests/threads/',
  software: true,
  async run({ check, ev }) {
    const r = await ev(async () => {
      const { mk, THREE } = threedogThreads, T = threedogThreads.all;
      const c = document.createElement('canvas'); c.width = 128; c.height = 128; c.style.cssText = 'position:fixed;left:0;top:0;width:128px;height:128px'; document.body.append(c);
      const E = mk(T.createEngine, 'colour-path', { canvas: c, headless: false, lights: false });
      await E.start(); E.haltLoop();
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10); cam.position.z = 5;
      E.camera = cam; E.scene.background = new THREE.Color(0.2, 0.4, 0.6);
      const quad = (x, y, color, opts = {}, z = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color, ...opts })); m.position.set(x, y, z); E.scene.add(m); return m; };
      quad(-0.5, 0.5, 0xc08040);
      quad(0.5, 0.5, 0xc08040); quad(0.5, 0.5, 0x4080c0, { transparent: true, opacity: 0.5 }, 0.1);
      const noWrite = quad(-0.5, -0.5, 0xff0000, { transparent: true, opacity: 1, depthWrite: false }, 0.2); const under = quad(-0.5, -0.5, 0x00ff00, {}, 0.1);
      const read = () => {
        E.renderer.render ? E.renderOnce() : 0;
        const s = document.createElement('canvas'); s.width = s.height = 128; const g = s.getContext('2d', { willReadFrequently: true }); g.drawImage(c, 0, 0, 128, 128);
        const px = (x, y) => [...g.getImageData(x, y, 1, 1).data].slice(0, 3);
        return { bg: px(64, 64), solid: px(32, 32), glass: px(96, 32), order: px(32, 96) };
      };
      const out = {}, far = (a, b) => Math.max(...['bg', 'solid', 'order'].flatMap(k => a[k].map((v, i) => Math.abs(v - b[k][i]))));   // glass has its own check below
      for (const [name, tm, ex] of [['none', THREE.NoToneMapping, 1], ['aces', THREE.ACESFilmicToneMapping, 1], ['agx', THREE.AgXToneMapping, 0.7]]) {
        E.renderer.toneMapping = tm; E.renderer.toneMappingExposure = ex;
        for (const k of E.scene.children) if (k.material) k.material.needsUpdate = true;
        const plain = read();
        const h = E.post.add({ name: 'neutral' + name, slot: 'ldr', fuse: { glsl: 'color.rgb *= 1.0;' } });
        const post = read();
        h.remove();
        const back = read();
        out[name] = { plain, post, back, jump: far(plain, post), backJump: far(plain, back) };
      }
      c.remove();
      return out;
    });
    for (const k of ['none', 'aces', 'agx']) {
      check(`${k}: the post chain does not move a colour`, r[k].jump <= 3, JSON.stringify(r[k]));
      check(`${k}: taking it off comes back exact`, r[k].backJump <= 1, JSON.stringify(r[k]));
      check(`${k}: the picture is drawn`, r[k].plain.bg.some(v => v > 20), JSON.stringify(r[k].plain));
    }
    // Why glass differs by design, in plain three.js as here: drawn straight it blends in the output's sRGB values, through a chain it blends in linear light. No second conversion:
    // each is exactly its own formula (0xc08040 over 0x4080c0 at one half: sRGB mean 128; linear mean 146)
    check('glass drawn straight blends in sRGB, through a chain in linear light, each exact', Math.abs(r.none.plain.glass[0] - 128) <= 1 && Math.abs(r.none.post.glass[0] - 146) <= 2, JSON.stringify([r.none.plain.glass, r.none.post.glass]));
    check('no tone map: the background is the colour given, in sRGB output', Math.abs(r.none.plain.bg[0] - 124) <= 2 && Math.abs(r.none.plain.bg[2] - 203) <= 2, JSON.stringify(r.none.plain));
    check('a tone map reaches the opaque quad', r.aces.plain.solid.join() !== r.none.plain.solid.join(), JSON.stringify([r.aces.plain, r.none.plain]));
    check('a transparent mesh without depth write draws over what is under it, sorted as three does', r.none.plain.order[0] > 200 && r.none.plain.order[1] < 40, JSON.stringify(r.none.plain));
  },
}];
