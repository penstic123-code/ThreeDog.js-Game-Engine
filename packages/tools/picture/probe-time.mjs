// Page side of the picture check (probe.mjs says how these files run): the same view at 12:00 and 00:00, then back.

/**
 * The game's own sources with their value at each time: local lights (not the sky's sun / fill / ambient) and glowing materials.
 * A local LIGHT whose intensity differs between 12:00 and 00:00 is switched by the game with the time (street lamps): it is the game's night lighting,
 * not "lighting that does not follow the time", so the time tests run with those at 0 at both times. Time-switched GLOW (emissive windows, signs) stays
 * in: it lights nothing, and a night made bright by it is what the "not lighting" cause names (listed by name and value in t.glow).
 */
export function timeSources({ scene, mine }) {
  const own = [];
  scene.traverse(o => {
    if (o.isLight && !mine.has(o) && !o.isAmbientLight && !o.isHemisphereLight && !o.isDirectionalLight) own.push({ o, key: 'intensity', name: o.name || o.type });
    if (o.isMesh) for (const m of [].concat(o.material)) if (m?.emissive && !own.some(s => s.o === m)) own.push({ o: m, key: 'emissiveIntensity', name: `material '${m.name || m.type}'` });
  });
  return own;
}

// scene.background is named only where it shows: a sky dome (or any mesh) drawn over it hides the engine's baseline gray, and naming that
// gray as "what stays lit" sent the AI after a color nobody sees. One render with the background color inverted: no pixel moves = covered
export function backgroundShows({ scene, grab }, at) {
  if (scene.background?.isColor) {
    const bg = scene.background, was = bg.clone(), before = grab();
    bg.setRGB(1 - was.r, 1 - was.g, 1 - was.b);
    let shows = 0;
    try { const after = grab(); for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) > 2 / 255) shows++; } finally { bg.copy(was); }
    if (shows) at.midnight.background = { name: 'scene.background', value: '#' + was.getHexString(), shows: shows / before.length };
  }
}

/**
 * Still at 00:00: how much of that brightness is not light at all? Every light and the environment at 0, then the fog color black (uniforms only).
 * Always measured (two renders): with the game's lamps taken out, a night lit by a gray background and fog that never darken is the contradiction even
 * when noon is clearly brighter (the hint 'time-flat').
 */
export function nightWithoutLight(c, at, lum, zeroDriven) {
  const { scene, grab, mean } = c;
  const lights = []; scene.traverse(o => { if (o.isLight) lights.push([o, o.intensity]); });
  const envWas = scene.environmentIntensity;
  lights.forEach(([o]) => { o.intensity = 0; }); scene.environmentIntensity = 0;
  try { lum.unlit = mean(grab()); } finally { lights.forEach(([o, v]) => { o.intensity = v; }); scene.environmentIntensity = envWas; }
  if (scene.fog?.color) {
    const fc = scene.fog.color.clone(); at.midnight.fog = { name: 'fog color', value: '#' + fc.getHexString() };
    scene.fog.color.setRGB(0, 0, 0);
    try { lum.noFog = zeroDriven(() => mean(grab())); } finally { scene.fog.color.copy(fc); }
  }
  backgroundShows(c, at);
}

export function probeTime(c, time) {
  const { e, R, scene, sun, hemi, pic, grab, mean, out } = c;
  const cal = e.calendar, sky = e.sky;
  if (!(time === 'auto' ? cal && sky : time && sky)) return;
  const read = () => cal ? cal.timeOfDay : sky.fixedTime, write = v => { if (cal) cal.timeOfDay = v; else sky.fixedTime = v; };
  const was = read(), at = {}, lum = {};
  const own = timeSources(c);
  const zeroDriven = fn => { const d = own.filter(s => s.key === 'intensity' && s.noon !== s.midnight), w = d.map(s => s.o[s.key]); d.forEach(s => { s.o[s.key] = 0; }); try { return fn(); } finally { d.forEach((s, i) => { s.o[s.key] = w[i]; }); } };
  const base2 = {};
  try {
    for (const [k, v] of [['noon', 0.5], ['midnight', 0]]) {
      write(v); e._frameHooks(0, true); R.shadowMap.needsUpdate = true;   // the sun moved: redraw its shadow map (only here; the other renders reuse it)
      lum[k] = mean(grab(true));
      own.forEach(s => { s[k] = s.o[s.key]; });
      at[k] = { sun: sun && { name: 'sun.intensity', value: sun.intensity }, hemi: hemi && { name: 'hemi.intensity', value: hemi.intensity },
        env: scene.environment && { name: 'scene.environmentIntensity', value: scene.environmentIntensity }, exposure: { name: 'exposure', value: R.toneMappingExposure } };
    }
    const driven = own.filter(s => s.key === 'intensity' && s.noon !== s.midnight);
    const glow = own.filter(s => s.key === 'emissiveIntensity' && s.noon !== s.midnight);
    if (glow.length) lum.glow = glow.slice(0, 4).map(s => ({ name: `${s.name} emissiveIntensity`, value: s.midnight }));
    if (driven.length) {   // two more renders, only for a game that switches its own lights with the time (we are at 00:00 now)
      base2.midnight = zeroDriven(() => mean(grab()));
      write(0.5); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; grab(true);
      base2.noon = zeroDriven(() => mean(grab()));
      write(0); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; grab(true);
      lum.base = base2; lum.driven = [...new Set(driven.map(s => s.name))];
    }
    nightWithoutLight(c, at, lum, zeroDriven);
  } finally { write(was); e._frameHooks(0, true); R.shadowMap.needsUpdate = true; }   // lights back at the shot's time, and the sun's shadow map redrawn for it (the probes left the midnight one); the next real frame draws it
  out.time = { ...lum, at, envSource: pic.environment?.present ? { name: 'scene.environment', value: scene.environment.name || scene.environment.type || 'a map' } : null };
}
