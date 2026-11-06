// Page side of the picture check (probe.mjs says how these files run): every visible light that casts; their shadow intensity to 0 shows exactly which
// pixels the shadows darken.

export function isShadowed(on, off) { return off - on > 0.015 && (off - on) / Math.max(off, 1e-3) > 0.06; }

export function darkened(on, off) {
  let n = 0, depth = 0;
  for (let i = 0; i < on.length; i++) if (isShadowed(on[i], off[i])) { n++; depth += (off[i] - on[i]) / off[i]; }
  return { area: n / on.length, depth: n ? depth / n : 0 };
}

/** The facts about the key caster and its shadow box; returns the point the camera looks at */
export function shadowFacts({ e, cam }, s, key, nCast, nRecv) {
  const sc = key.shadow.camera;
  const up = key.position.y - (key.target?.position.y ?? 0) > 0;
  const center = key.target?.position ?? { x: 0, y: 0, z: 0 };
  // what the camera looks at: engine.focus, else a point 20 m ahead
  const f = e.focus?.isVector3 ? e.focus : cam.getWorldDirection(cam.position.clone()).multiplyScalar(20).add(cam.position);
  const viewDist = Math.hypot(f.x - center.x, f.z - center.z), extent = sc.isOrthographicCamera ? (sc.right - sc.left) / 2 : NaN;
  Object.assign(s, {
    casters: nCast, receivers: nRecv, intensity: key.shadow.intensity, sunLit: up && key.intensity > 0.05,
    biasMeters: Math.abs(key.shadow.bias) * (sc.far - sc.near), depthRange: sc.far - sc.near, normalBias: key.shadow.normalBias,
    // camera forward against the light's direction (light -> target): above 0.6 the sun shines from behind the camera
    sunBehind: cam.getWorldDirection(cam.position.clone()).dot(center.clone ? center.clone().sub(key.position).normalize() : key.position.clone().negate().normalize()) > 0.6,
    extent, viewDist, outside: viewDist > extent * 1.05, texel: (2 * extent) / key.shadow.mapSize.x, mask: null,
  });
  return f;
}

/** How the view can get cascades, a shadow texel's size on screen, the settings the hints quote */
export function shadowView({ e, R, cam, sun, params }, s, key, f) {
  // how the view can get cascades: none when they are on, else on the engine sun or the game's own light
  s.split = e.shadows?.csm ? null : e.sky && key === e.lights?.sun ? 'engine' : 'own';
  // one shadow texel on screen, at the point the camera looks at
  const cv0 = R.domElement, far = cam.position.distanceTo(f);
  s.texelPx = s.texel * cv0.height / (cam.isPerspectiveCamera ? 2 * Math.tan(cam.fov * Math.PI / 360) * far : (cam.top - cam.bottom) / cam.zoom);
  s.settings = key === sun ? [params.bias, params.normalBias, params.mapSize, params.extent].filter(Boolean)
    : [['bias', key.shadow.bias], ['normalBias', key.shadow.normalBias], ['mapSize', key.shadow.mapSize.x]].map(([k, value]) => ({ name: `${key.type} shadow.${k}`, value }));
}

// very dark shadows: how much the fill adds right there (fill off once, on the shadowed pixels only). A cost gate, not a verdict: one render only
// when shadows are deep. Why not the frame's key / fill: lit ground dominates that mean, and a game whose key is a SpotLight has no 'key' at all
export function shadowFill({ scene, base, grab }, s, unshadowed) {
  if (!(s.area >= 0.003 && s.depth >= 0.7)) return;
  const fills = []; scene.traverse(o => { if (o.isAmbientLight || o.isHemisphereLight || o.isLightProbe) fills.push([o, o.intensity]); });
  const envWas = scene.environmentIntensity;
  fills.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
  let noFill; try { noFill = grab(); } finally { fills.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
  let lit = 0, dark = 0, gone = 0, n = 0;
  for (let i = 0; i < base.length; i++) if (isShadowed(base[i], unshadowed[i])) { n++; lit += unshadowed[i]; dark += base[i]; gone += base[i] - noFill[i]; }
  s.dark = { luma: dark / n, fill: Math.max(0, gone) / Math.max(lit, 1e-3) };
}

// the shadow alone at canvas pixels (centered, 1:1): the probe's small copy averages stripes away. The mask goes to node (shadowEdges), as the pixels do
export function shadowEdgeMask(c, s, casters, was) {
  const { e, R, lumaOf, grab } = c, cv = R.domElement, mw = Math.min(cv.width, 960), mh = Math.min(cv.height, 540), c3 = document.createElement('canvas'); c3.width = mw; c3.height = mh;
  const g3 = c3.getContext('2d', { willReadFrequently: true }), sx = (cv.width - mw) >> 1, sy = (cv.height - mh) >> 1;
  const full = () => { e._render(0, false); g3.drawImage(cv, sx, sy, mw, mh, 0, 0, mw, mh); return lumaOf(g3.getImageData(0, 0, mw, mh).data); };
  // two reads far enough apart to see what moves by itself: film grain changes 24 times a second, and two renders back to back read as still
  const on = full(), wait = performance.now() + 50;
  while (performance.now() < wait);
  const again = full();
  casters.forEach(l => { l.shadow.intensity = 0; });
  let off; try { off = full(); } finally { casters.forEach((l, i) => { l.shadow.intensity = was[i]; }); }
  const power = casters.map(l => l.intensity);
  casters.forEach(l => { l.intensity = 0; });
  let unlit; try { unlit = full(); } finally { casters.forEach((l, i) => { l.intensity = power[i]; }); }
  // two identical renders that differ: moving film grain or any animated post. On / off then differs by itself in a speckle the stripe test
  // reads as bands (82-97% on a picture with none), so what changes by itself is unread, and a picture mostly that gets no verdict. Unread too: a pixel the casting
  // lights add nothing to cannot show a shadow, so it says nothing about one. Glowing cracks through a shadowed rock read as lit gaps, and so as stripes
  const bits = new Uint8Array(Math.ceil(mw * mh / 8)), unread = new Uint8Array(bits.length);
  let moving = 0;
  for (let i = 0; i < on.length; i++) {
    const still = Math.abs(on[i] - again[i]) <= 0.015;
    if (!still) moving++;
    if (!still || off[i] - unlit[i] <= 0.015) unread[i >> 3] |= 1 << (i & 7);
    else if (isShadowed(on[i], off[i])) bits[i >> 3] |= 1 << (i & 7);
  }
  s.edgeNoise = moving / on.length;
  const text = b => { let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(t); };
  s.edgeMask = { w: mw, h: mh, b64: text(bits), unread: text(unread) };
  if (s.edgeNoise < 0.02) shadowGrid(c, s, casters, full, { on, again, mw, mh });
  grab();   // raw back to the shot's own frame for the probes below
}

/** The next render redraws the shadow maps, cascades too */
export function askShadows({ R }, casters) {
  if (R.shadowMap) R.shadowMap.needsUpdate = true;
  for (const l of casters) { l.shadow.needsUpdate = true; for (const x of l.shadow.shadowNode?.lights ?? []) x.shadow.needsUpdate = true; }
}

/**
 * The shadow map's pixel grid moved by half a pixel, the picture read again. s.grid: share, of the picture, where that moves a shadow by 3 or more screen pixels; thick, of what moved at all.
 * Light, casters and receivers stay where they are, so only what the grid decides can change. Why not corners on the mask: trees, crates and a soft rim over a mottled
 * ground have corners too, and that count stayed the same with a map four times finer. Thin lines of change are every edge's own rounding, hence the 3 x 3 test.
 * setViewOffset lives on the shadow camera, so it reaches a light that places itself too; a point light's six faces do not take it.
 */
export function shadowGrid(c, s, casters, full, { on, again, mw, mh }) {
  const cams = casters.filter(l => !l.isPointLight).flatMap(l => [l, ...l.shadow.shadowNode?.lights ?? []]).map(l => [l.shadow.camera, l.shadow.mapSize.x]);
  if (!cams.length) return;
  cams.forEach(([sc, n]) => sc.setViewOffset(n, n, 0.5, 0.5, n, n));
  let now;
  try { askShadows(c, casters); now = full(); } finally { cams.forEach(([sc]) => sc.clearViewOffset()); askShadows(c, casters); }
  const moved = new Uint8Array(on.length);
  let band = 0, thick = 0;
  for (let i = 0; i < on.length; i++) band += moved[i] = Math.abs(on[i] - again[i]) <= 0.015 && Math.abs(now[i] - on[i]) > 0.015 ? 1 : 0;
  for (let y = 1; y < mh - 1; y++) for (let x = 1; x < mw - 1; x++) {
    let n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += moved[(y + j) * mw + x + i];
    if (n === 9) thick++;
  }
  s.grid = { share: thick / on.length, thick: thick / Math.max(band, 1) };
}

export function probeShadows(c) {
  const { e, R, scene, sun, base, grab, out } = c, casters = [];
  let nCast = 0, nRecv = 0;
  scene.traverse(o => {
    if (o.isLight && o.castShadow && o.visible && o.intensity > 0 && o.shadow) casters.push(o);
    if (o.isMesh && o.visible) { if (o.castShadow) nCast++; if (o.receiveShadow) nRecv++; }
  });
  if (!(R.shadowMap.enabled && casters.length)) return;
  const was = casters.map(l => l.shadow.intensity);
  const noShadow = () => { casters.forEach(l => { l.shadow.intensity = 0; }); try { return grab(); } finally { casters.forEach((l, i) => { l.shadow.intensity = was[i]; }); } };
  const unshadowed = noShadow(), s = darkened(base, unshadowed);
  const key = sun && casters.includes(sun) ? sun : casters[0], f = shadowFacts(c, s, key, nCast, nRecv);
  if (s.area < 0.003 && s.sunLit && e.debug?.view) {
    // none visible: is it the shadow map (nothing in it) or the fill light (in it, washed out)? The debug 'shadow' view lights with direct light only
    e.debug.view('shadow', { owner: 'shot-picture', force: true });
    try { const on = grab(); s.mask = darkened(on, noShadow()); } finally { e.debug.view('off', { owner: 'shot-picture', force: true }); }
  }
  shadowView(c, s, key, f);
  shadowFill(c, s, unshadowed);
  shadowEdgeMask(c, s, casters, was);
  out.shadows = s;
}
