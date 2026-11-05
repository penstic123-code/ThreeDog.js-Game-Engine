// Page side of the picture check (probe.mjs says how these files run).
// Facts about what hand-written materials do to the picture, each from renders of those objects alone (the rest hidden), values put back after:
// - a ShaderMaterial in view, fog on: the fog made total (uniforms only, no recompile), its color black then white. Pixels that do not move ignore fog.
// - the same with exposure far down and far up, when a tone curve is on and no post chain applies it for everyone.
// - transparent neighbors: two transparent meshes with one renderOrder whose boxes overlap, drawn in both orders. Pixels that move depend on an order
//   three picks from object centers, so it can flip as the camera moves. Why not judge by boxes alone: additive pairs and pairs not on top of each other
//   overlap harmlessly; only the pixels say. Every answer below a clear share is 'not sure'.

/** What both probes below use: only(keep, fn) draws the given objects alone, verdict() reads one object's answer */
export function ownDrawTools({ scene }) {
  const MOVED = 6 / 255, FEW = 12, drawable = o => o.isMesh || o.isPoints || o.isLine || o.isSprite;
  const only = (keep, fn) => {
    const k = new Set(keep), hid = [];
    scene.traverse(o => { if (drawable(o) && o.visible && !k.has(o)) { o.visible = false; hid.push(o); } });
    try { return fn(); } finally { hid.forEach(o => { o.visible = true; }); }
  };
  // of the pixels this object covers, the share that followed the change; follows and ignores are clear answers, the middle is not. Covered is judged
  // against the empty picture under the same setting (ea for a, eb for b): the background moves with exposure, and it is not the object's doing
  const verdict = (ea, eb, a, b) => {
    let n = 0, moved = 0;
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - ea[i]) <= MOVED && Math.abs(b[i] - eb[i]) <= MOVED) continue;
      n++; if (Math.abs(a[i] - b[i]) > MOVED) moved++;
    }
    const share = n ? moved / n : 0;
    return { pixels: n, moved, answer: n < FEW ? 'not sure' : share >= 0.8 ? 'follows' : share <= 0.05 ? 'ignores' : 'not sure' };
  };
  return { MOVED, FEW, drawable, only, verdict };
}

/** The ShaderMaterials in view with their objects */
export function shadersInView({ T, scene }, { drawable }, world) {
  const shaders = new Map(), sphere = new T.Sphere();
  scene.traverseVisible(o => {
    if (!drawable(o) || !o.material) return;
    for (const m of [].concat(o.material)) {
      if (!m?.isShaderMaterial) continue;
      if (o.geometry) {   // a mesh around the camera is a sky: fog and exposure do not apply to it in any picture
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
        if (sphere.containsPoint(world)) continue;
      }
      (shaders.get(m) ?? shaders.set(m, []).get(m)).push(o);
    }
  });
  return shaders;
}

/** One shader material's answers: does it take the fog, does it take the tone curve */
export function shaderRow({ R, grab }, { only, verdict }, m, objs, { fog, curve, x, low, high, empty, emptyLow, emptyHigh }) {
  const row = { name: m.name || `${m.type} ${m.uuid.slice(0, 8)}`, toneMapped: m.toneMapped };
  only(objs, () => {
    if (fog?.color) {
      const c = fog.color.clone(), n = fog.near, f = fog.far, d = fog.density;
      if (fog.isFogExp2) fog.density = 1e3; else { fog.near = 0; fog.far = 1e-3; }
      try {
        fog.color.setRGB(0, 0, 0); const black = grab();
        fog.color.setRGB(1, 1, 1); const white = grab();
        row.fog = verdict(empty, empty, black, white);
        // its own fog from uniforms the game feeds in onRender cannot move here: hooks do not run in the probe
        if (row.fog.answer === 'ignores' && /fog/i.test(`${m.vertexShader}${m.fragmentShader}`)) { row.fog.answer = 'not sure'; row.fog.why = 'its shader text says fog, maybe through its own uniforms, which this render does not feed'; }
      } finally { fog.color.copy(c); if (fog.isFogExp2) fog.density = d; else { fog.near = n; fog.far = f; } }
    }
    if (curve) {
      try { R.toneMappingExposure = low; const dim = grab(); R.toneMappingExposure = high; row.tone = verdict(emptyLow, emptyHigh, dim, grab()); } finally { R.toneMappingExposure = x; }
    }
  });
  return row;
}

export function probeShaders(c, own, world) {
  const { T, R, e, scene, grab, out } = c, { only } = own, shaders = shadersInView(c, own, world);
  const fog = scene.fog, curve = R.toneMapping !== T.NoToneMapping && !e.post?.active;
  if (!(shaders.size && (fog?.color || curve))) return;
  const x = R.toneMappingExposure, low = x / 4, high = x * 4, rows = [];
  const emptyAt = v => { R.toneMappingExposure = v; try { return only([], grab); } finally { R.toneMappingExposure = x; } };
  const empty = emptyAt(x), emptyLow = curve ? emptyAt(low) : null, emptyHigh = curve ? emptyAt(high) : null;
  // shortcut: the 6 newest shader materials (5 renders each); says how many it left out
  for (const [m, objs] of [...shaders].sort((a, b) => b[0].id - a[0].id).slice(0, 6)) rows.push(shaderRow(c, own, m, objs, { fog, curve, x, low, high, empty, emptyLow, emptyHigh }));
  out.shaders = { rows, left: Math.max(0, shaders.size - rows.length) };
}

export function probeTransparent({ T, scene, cam, grab, out }, { MOVED, FEW, only }, world) {
  const box = new T.Box3();
  const see = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const clear = [];
  scene.traverseVisible(o => { if (o.isMesh && !o.isInstancedMesh && [].concat(o.material).some(m => m?.transparent) && see.intersectsObject(o)) clear.push(o); });
  if (clear.length <= 1) return;
  // shortcut: the 48 nearest transparent meshes, and 4 pairs drawn; both limits are reported, so "none found" is never read as "none exist"
  const near = clear.map(o => [o, o.getWorldPosition(new T.Vector3()).distanceToSquared(world)]).sort((a, b) => a[1] - b[1]).slice(0, 48).map(x => x[0]);
  const boxes = near.map(o => box.clone().setFromObject(o)), pairs = [];
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++)
    if (near[i].renderOrder === near[j].renderOrder && boxes[i].intersectsBox(boxes[j])) pairs.push([near[i], near[j]]);
  const swapped = [];
  for (const [a, b] of pairs.slice(0, 4)) {
    const ro = a.renderOrder;
    only([a, b], () => {
      try {
        a.renderOrder = ro + 1; const ab = grab();
        a.renderOrder = ro; b.renderOrder = ro + 1; const ba = grab();
        let px = 0; for (let i = 0; i < ab.length; i++) if (Math.abs(ab[i] - ba[i]) > MOVED) px++;
        if (px >= FEW) swapped.push({ a: a.name || a.uuid.slice(0, 8), b: b.name || b.uuid.slice(0, 8), pixels: px, share: px / ab.length });
      } finally { a.renderOrder = ro; b.renderOrder = ro; }
    });
  }
  out.transparent = { meshes: clear.length, looked: near.length, pairs: pairs.length, tried: Math.min(4, pairs.length), swapped };
}

export function probeOwnDraws(c) {
  const own = ownDrawTools(c), world = new c.T.Vector3();
  c.cam.getWorldPosition(world);
  probeShaders(c, own, world);
  probeTransparent(c, own, world);
}
