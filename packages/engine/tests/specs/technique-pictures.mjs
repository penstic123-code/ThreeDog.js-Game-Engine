// Technique examples (examples/techniques/stylized-shading, procedural-surface, outlines-and-rim; pages /technique-*.html).
// Each check measures the effect the example teaches, on pixels, so a patch that compiles but does nothing fails here:
// toon gives a few flat luminance bands where painterly gives a spread, every route still darkens in the engine's sun shadow and painterly
// shadows lean blue; the wall noise picked for the camera varies at that camera while the close-up scale has faded out; cavity AO darkens
// the foot of the wall; instance jitter varies crate colors; outlines put dark pixels on the silhouette where the plain column has none.

// Renders the scene once into a render target (linear, before tone mapping) and returns a reader of world points / screen rects.
const PIXELS = `(() => {
  const THREE = window.techTest.THREE, R = engine.renderer, cam = engine.camera, sc = engine.scene;
  const size = R.getDrawingBufferSize(new THREE.Vector2()), W = size.x, H = size.y;
  return function render(only, camera = cam) {
    const hidden = [];
    if (only) sc.traverse(o => { if (o.isMesh && o.visible && !only.includes(o)) { o.visible = false; hidden.push(o); } });
    const bg = sc.background; if (only) sc.background = null;
    const rt = new THREE.WebGLRenderTarget(W, H), buf = new Uint8Array(W * H * 4);
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, camera);
    R.readRenderTargetPixels(rt, 0, 0, W, H, buf); R.setRenderTarget(null); rt.dispose();
    hidden.forEach(o => { o.visible = true; }); sc.background = bg;
    const px = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; };
    const lum = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    const at = w => { const v = new THREE.Vector3(...w).project(camera); return px((v.x + 1) / 2 * W, (v.y + 1) / 2 * H); };
    const area = (x, y, r) => { let s = [0, 0, 0], n = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const p = px(x + dx, y + dy); s = s.map((v, k) => v + p[k]); n++; } return s.map(v => v / n); };
    const atArea = (w, r = 2) => { const v = new THREE.Vector3(...w).project(camera); return area((v.x + 1) / 2 * W, (v.y + 1) / 2 * H, r); };
    return { W, H, buf, px, lum, at, atArea };
  };
})()`;

const run = (body) => `(() => { try { engine.step(0.2); const render = ${PIXELS}; ${body} } catch (err) { return { err: String(err.stack) }; } })()`;

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'technique stylized-shading: toon bands show in the luminance histogram, every route darkens in the sun shadow, painterly shadows lean blue',
    url: '/technique-shading.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => (0, eval)(src), run(`
        const { columns } = window.techTest, out = { hist: {}, shadow: {} };
        for (const c of columns) {
          // the ball alone: a 32-bin luminance histogram of its pixels
          // sun only (hemisphere off for this read): toon bands the sun, the smooth hemisphere fill would blur the histogram
          const hemi = window.techTest.hemi, hi = hemi.intensity; hemi.intensity = 0;
          const img = render([c.ball]), bins = new Array(32).fill(0); let n = 0;
          for (let i = 0; i < img.buf.length; i += 4) if (img.buf[i + 3] > 0) { bins[Math.min(31, img.lum([img.buf[i], img.buf[i + 1], img.buf[i + 2]]) / 8 | 0)]++; n++; }
          hemi.intensity = hi;
          // a valley: a bin under 25% of the highest bins on both sides of it, i.e. two separate luminance clusters (bands), not one spread
          let valleys = 0;
          for (let i = 1; i < 31; i++) if (bins[i] < 0.25 * Math.min(Math.max(...bins.slice(0, i)), Math.max(...bins.slice(i + 1))) && bins[i - 1] >= bins[i]) valleys++;
          out.hist[c.name] = { n, valleys, bins: bins.join(',') };
        }
        // straight down, so no model stands between the camera and the ground spots
        const top = new window.techTest.THREE.PerspectiveCamera(40, engine.camera.aspect, 1, 100); top.position.set(0, 28, 0.01); top.lookAt(0, 0, 0); top.updateMatrixWorld();
        const img = render(null, top);
        for (const c of columns) { const s = img.atArea(c.shadowSpot), o = img.atArea(c.openSpot); out.shadow[c.name] = { shadow: s.map(v => v | 0), open: o.map(v => v | 0), ratio: +(img.lum(s) / img.lum(o)).toFixed(3) }; }
        const { sun, hemi } = window.techTest; out.sun = { pos: sun.position.toArray(), i: sun.intensity, hemi: hemi.intensity };
        return out;`));
      if (r.err) { check('runs without error', false, r.err); return; }
      const h = r.hist;
      check('toon (ramp texture): the ball luminance histogram splits into separate bands (a valley between clusters)', h['toon (ramp texture)'].valleys >= 1, JSON.stringify(h['toon (ramp texture)']));
      check('toon (smoothstep): the ball luminance histogram splits into separate bands', h['toon (smoothstep)'].valleys >= 1, JSON.stringify(h['toon (smoothstep)']));
      check('painterly and stylized PBR: one continuous spread, no valley (so the measure tells bands from gradients)', h.painterly.valleys === 0 && h['stylized PBR'].valleys === 0, JSON.stringify({ p: h.painterly, s: h['stylized PBR'] }));
      for (const [name, s] of Object.entries(r.shadow)) check(`${name}: ground in the house's cast shadow is darker than open ground (ratio < 0.8)`, s.ratio < 0.8, JSON.stringify({ ...s, sun: r.sun }));
      const p = r.shadow.painterly, blue = c => c[2] / Math.max(1, c[0]);
      check('painterly: the cast shadow leans blue (blue / red higher than on open ground)', blue(p.shadow) > blue(p.open) * 1.08, JSON.stringify(p));
      check('stylized PBR: shade is lifted, never near black (shadow keeps > 25% of open ground)', r.shadow['stylized PBR'].ratio > 0.25, JSON.stringify(r.shadow['stylized PBR']));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'technique procedural-surface: camera-scaled noise varies at the camera, close-up scale fades out, cavity darkens the foot, instance jitter',
    url: '/technique-surface.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => (0, eval)(src), run(`
        const { walls, crates, scales } = window.techTest, img = render(), out = { std: {}, scales };
        const std = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
        for (const w of walls) out.std[w.name] = +std(w.grid.map(p => img.lum(img.atArea(p, 3)))).toFixed(2);   // 7x7 px averages: what reads as patches, not pixel sparkle
        const last = walls[3]; out.foot = img.lum(img.atArea(last.foot, 1)); out.middle = img.lum(img.atArea(last.middle, 1));
        out.crates = Object.fromEntries(crates.map(c => [c.kind, +std(c.spots.map(p => { const v = img.atArea(p, 1); return v[0] * 0.5 + v[1] * 0.3 + v[2] * 0.2; })).toFixed(2)]));
        return out;`));
      if (r.err) { check('runs without error', false, r.err); return; }
      const s = r.std, picked = s['noise, scale from camera'], close = s['noise, tuned up close'];
      check('noise at the scale picked for the camera varies across the wall at that camera (luminance std > 3 of 255)', picked > 3, JSON.stringify(r));
      check('the same noise tuned up close has faded out at this distance (picked > 2x close-up)', picked > 2 * close, JSON.stringify(s));
      check('baked cavity: the foot of the wall is darker than its middle (< 0.85)', r.foot < r.middle * 0.85, JSON.stringify({ foot: r.foot, middle: r.middle }));
      check('per-instance jitter: crate colors vary (std > 2x the one-color row, > 2)', r.crates.jitter > 2 && r.crates.jitter > 2 * r.crates.same, JSON.stringify(r.crates));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: 'technique outlines-and-rim: post outline and both hulls darken the silhouette, the plain column does not, rim brightens the edge',
    url: '/technique-outlines.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      // the post outline only exists in the composed frame: read the canvas right after a rendered step (same task, before it is presented)
      const r = await ev(() => { try {
        const { THREE, columns } = window.techTest, R = engine.renderer, gl = R.getContext(), cam = engine.camera;
        engine.step(1 / 30);
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, buf = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const lum = (x, y) => { const i = (Math.round(y) * W + Math.round(x)) * 4; return 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; };
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const out = {};
        for (const c of columns) {
          // a scanline through the capsule's chest: inside, the silhouette band, and the background just beyond it
          const ctr = new THREE.Vector3(...c.body.at), edge = ctr.clone().addScaledVector(right, -c.body.radius);
          const a = ctr.clone().project(cam), b = edge.project(cam), y = (a.y + 1) / 2 * H, xc = (a.x + 1) / 2 * W, xe = (b.x + 1) / 2 * W, rpx = xc - xe;
          let band = 255; for (let x = xe - 4; x <= xe + 3; x++) band = Math.min(band, lum(x, y));
          const inside = lum(xe + rpx * 0.25, y), beyond = lum(xe - 8, y);
          out[c.name] = { band: +band.toFixed(1), inside: +inside.toFixed(1), beyond: +beyond.toFixed(1), rimEdge: +(Math.max(lum(xe + 1, y), lum(xe + 2, y), lum(xe + 3, y)) / inside).toFixed(3), rpx: +rpx.toFixed(1) };
        }
        return out;
      } catch (err) { return { err: String(err.stack) }; } });
      if (r.err) { check('runs without error', false, r.err); return; }
      const dark = c => c.band < 0.6 * Math.min(c.inside, c.beyond);
      check('plain column: no dark band at the silhouette (the measure tells lines from no lines)', !dark(r.none), JSON.stringify(r.none));
      for (const n of ['post outline', 'hull, world units', 'hull, screen px']) check(`${n}: the silhouette is darker than both sides (< 60%)`, dark(r[n]), JSON.stringify(r[n]));
      check('rim light: relative to its own middle, the capsule edge is brighter than without rim', r['rim light'].rimEdge > r.none.rimEdge * 1.05, JSON.stringify({ rim: r['rim light'], none: r.none }));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
