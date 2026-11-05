// Page side of the picture check (probe.mjs says how these files run): lights the game added, and what blows out the picture.

export function worldPos({ cam }, o) { return o.getWorldPosition(cam.position.clone()); }

/** Lights the game added (not the engine's sun / hemisphere) whose range reaches the view. Casting a shadow does not exempt a light: a game's shadowed street lamp or torch that lights nothing or glares is measured like any other */
export function lightsInReach(c) {
  const { e, scene, cam, mine } = c, cand = [], wp = o => worldPos(c, o);
  scene.traverse(o => { if (o.isLight && !o.isAmbientLight && !o.isHemisphereLight && o.visible && o.intensity > 0 && !mine.has(o)) cand.push(o); });
  // a light "should show" when its range holds the camera or the point it looks at: a far lamp behind a wall or in fog changing nothing is no contradiction
  const focus = e.focus?.isVector3 ? e.focus : null;
  const reaches = o => o.isDirectionalLight || !o.distance || wp(o).distanceTo(cam.position) <= o.distance || (focus && wp(o).distanceTo(focus) <= o.distance * 0.7);
  return cand.filter(reaches);
}

/** glareOf(off): the glare of one source, from the picture with it off */
export function glareTools({ W, base, baseClip, clipped }) {
  const N = base.length;
  // What the glare costs: the mean luma edge (|right| + |below| neighbor difference) over the pixels this source blows out, with the source on
  // and off. Why: "near white" alone reads as a verdict on every glow; whether the sign's letters, the wall's texture or the face under the lamp
  // are gone is the fact a game can weigh against the glow it wants
  const edge = (L, m) => { let s = 0, n = 0; for (let i = 0; i < N; i++) if (m[i]) { const x = i % W; s += (x < W - 1 ? Math.abs(L[i] - L[i + 1]) : 0) + (i + W < N ? Math.abs(L[i] - L[i + W]) : 0); n++; } return n ? s / n : 0; };
  // glare of one source: pixels clipped with it and not without it, and pixels it alone makes near-white (base >= 0.75, off at least 0.25 lower)
  const glareOf = off => {
    const c = clipped(off), gm = new Uint8Array(N); let gone = 0, halo = 0;
    for (let i = 0; i < N; i++) if (baseClip[i] && !c[i]) { gone++; gm[i] = 1; } else if (!baseClip[i] && base[i] >= 0.75 && base[i] - off[i] >= 0.25) halo++;
    return { clipped: gone / N, halo: halo / N, px: gone, ...(gone >= 3 && { detail: { on: edge(base, gm), off: edge(off, gm) } }) };
  };
  return glareOf;
}

export function maxDiff(a, b) { let mx = 0; for (let i = 0; i < a.length; i++) mx = Math.max(mx, Math.abs(a[i] - b[i])); return mx; }

// the sun / moon, sky fill, ambient and environment at 0 for one render (a light that changes nothing may only be outshone by them)
export function dimmed({ scene, mine }, fn) {
  const fill = []; scene.traverse(o => { if (o.isLight && (mine.has(o) || o.isAmbientLight || o.isHemisphereLight)) fill.push([o, o.intensity]); });
  const envWas = scene.environmentIntensity; fill.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
  try { return fn(); } finally { fill.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
}

/** One light turned off: did any pixel change, and what glare goes with it */
export function probeLight(c, o, glareOf, nClip, glare) {
  const { cam, base, grab, out } = c, wp = p => worldPos(c, p);
  const was = o.intensity; o.intensity = 0;
  let L; try { L = grab(); } finally { o.intensity = was; }
  const gq = nClip ? glareOf(L) : null;   // now: glareOf reads the last grab's bytes
  const fact = { name: o.name || o.uuid.slice(0, 8), type: o.type, intensity: o.intensity, ...(o.distance !== undefined ? { distance: o.distance, decay: o.decay } : {}),
    toCamera: wp(o).distanceTo(cam.position), changed: maxDiff(L, base) > 2 / 255, layers: o.layers.mask, cameraLayers: cam.layers.mask };
  // no pixel changed: try once more with the sun / fill / environment dimmed. Changes then = outshone (a lamp at dusk), not a light that lights nothing
  if (!fact.changed) fact.outshone = dimmed(c, () => { const on = grab(); o.intensity = 0; try { return maxDiff(grab(), on) > 2 / 255; } finally { o.intensity = was; } });
  out.lights.push(fact);
  if (gq && (gq.px >= 3 || gq.halo >= 0.002)) glare.push({ kind: 'light', ...fact, clipped: gq.clipped, halo: gq.halo, detail: gq.detail });
}

/** Glare from glowing materials: the brightest emissive materials on meshes in view, each turned off once (a uniform: no recompile) */
export function probeGlowGlare({ T, e, scene, cam, base, grab, out }, glareOf, nClip, glare) {
  const N = base.length;
  const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)), mats = new Map();
  scene.traverse(o => {
    if (!o.isMesh || !o.visible || !o.geometry || !fr.intersectsObject(o)) return;
    for (const m of [].concat(o.material)) if (m?.emissive && m.emissiveIntensity > 0 && Math.max(m.emissive.r, m.emissive.g, m.emissive.b) > 0) {
      const k = mats.get(m) ?? { m, meshes: 0 }; k.meshes++; mats.set(m, k);
    }
  });
  const strength = m => Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
  for (const { m, meshes } of [...mats.values()].sort((a, b) => strength(b.m) - strength(a.m)).slice(0, 3)) {
    const was = m.emissiveIntensity; m.emissiveIntensity = 0;
    let L; try { L = grab(); } finally { m.emissiveIntensity = was; }
    const gq = glareOf(L);
    if (gq.px >= 3 || gq.halo >= 0.002) glare.push({ kind: 'material', name: m.name || `${m.type} ${m.uuid.slice(0, 8)}`, meshes, emissive: '#' + m.emissive.getHexString(),
      emissiveIntensity: was, toneMapped: m.toneMapped, clipped: gq.clipped, halo: gq.halo, detail: gq.detail });
  }
  const b = e.post?.get?.('bloom');
  out.glare = { clipped: nClip / N, sources: glare.sort((x, y) => y.clipped + y.halo - x.clipped - x.halo),
    bloom: b ? { enabled: !!b.enabled, strength: b.params?.strength, threshold: b.params?.threshold, radius: b.params?.radius } : null };
}

/** Turn each light that reaches the view off and see if any pixel changes */
export function probeLights(c) {
  const { cam, baseClip } = c, nClip = baseClip.reduce((a, b) => a + b, 0), glareOf = glareTools(c), glare = [], far = o => worldPos(c, o).distanceTo(cam.position);
  // shortcut: the nearest 4 lights only (each costs one render, the picture check stays near 300 ms); a scene with more checks those near the camera
  for (const o of lightsInReach(c).sort((a, b) => far(a) - far(b)).slice(0, 4)) probeLight(c, o, glareOf, nClip, glare);
  if (nClip && c.T) probeGlowGlare(c, glareOf, nClip, glare);
}
