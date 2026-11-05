// Many-lights field methods (2026-11-05-many-lights). The game writes its whole picture (lights: false, own hemisphere), so the only lights are
// the ones counted here. A probe reads the canvas back to prove the lights reach the picture (the earlier number was void: lights were hidden).
export function lightMethods({ mkEngine, ready, frame, measure, gpuDone, r2, THREE }) {
  const SPAN = 60;
  /** Lit PBR world: a floor and 300 boxes spread over SPANxSPAN, a hemisphere only (no sun), camera high above looking down so every light is in view */
  async function world(extra = {}, shadows = false) {
    const e = mkEngine({ lights: false, ...extra });
    if (shadows) e.renderer.shadowMap.enabled = true;
    e.scene.add(new THREE.HemisphereLight(0x8899aa, 0x222222, 0.15));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 2, SPAN * 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 }));
    floor.receiveShadow = true; e.scene.add(floor);
    const m = new THREE.MeshStandardMaterial({ color: 0xb09070, roughness: 0.7 }), g = new THREE.BoxGeometry(1.5, 2, 1.5);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) { const b = new THREE.Mesh(g, m); b.position.set((rnd() - 0.5) * SPAN * 1.6, 1, (rnd() - 0.5) * SPAN * 1.6); b.castShadow = b.receiveShadow = true; e.scene.add(b); }
    e.camera.position.set(0, 55, 40); e.camera.lookAt(0, 0, 0);
    return e;
  }
  const spot = (i, n) => { const a = i * 2.399963, r = Math.sqrt((i + 0.5) / n) * SPAN * 0.8; return [Math.cos(a) * r, 3, Math.sin(a) * r]; };
  /** mean luma of the canvas right after a render (proof the lights reach the picture), 0..255 */
  function luma(e) {
    e._render(1 / 60);
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(e.renderer.domElement, 0, 0, 160, 90);
    const d = x.getImageData(0, 0, 160, 90).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    return r2(s / (d.length / 4));
  }
  const programs = e => e.renderer.info.programs?.length ?? null;
  return {
    /** n real PointLights (shadowN of them casting). Frame time, plus luma with lights on and off */
    async lightsReal({ n, shadowN = 0 }) {
      const e = await world({}, shadowN > 0); const ls = [];
      for (let i = 0; i < n; i++) { const l = new THREE.PointLight(0xffc080, 60, 18, 2); l.position.set(...spot(i, n)); if (i < shadowN) { l.castShadow = true; l.shadow.mapSize.set(512, 512); } e.scene.add(l); ls.push(l); }
      const t0 = performance.now(); await e.start(); const startMs = Math.round(performance.now() - t0);
      const on = luma(e); const m = await measure(e, 40);
      for (const l of ls) l.intensity = 0; const off = luma(e);
      const out = { n, shadowN, startMs, lumaOn: on, lumaOff: off, cpuMs: m.cpuMs, renderMs: m.renderMs, throughputMs: m.throughputMs, worstCpuMs: m.worstCpuMs, gpuTailMs: m.gpuTailMs, draws: m.drawCalls, programs: programs(e) };
      e.dispose(); return out;
    },
    /** lightPool: S sources, P real lights, k of them casting shadows */
    async lightsPool({ sources, pool, shadows = 0, sourceShadow = false }) {
      const { lightPool } = await import('../../index.js');
      const e = await world({}, shadows > 0); e.use(lightPool({ point: pool, shadows }));
      for (let i = 0; i < sources; i++) { const [x, y, z] = spot(i, sources); e.lightPool.add({ x, y, z }, { intensity: 60, distance: 18, color: 0xffc080, castShadow: sourceShadow }); }
      const t0 = performance.now(); await e.start(); const startMs = Math.round(performance.now() - t0);
      for (let i = 0; i < 30; i++) frame(e);   // let the pool settle on its choice
      const on = luma(e); const m = await measure(e, 40);
      const out = { sources, pool, shadows, sourceShadow, startMs, lumaOn: on, usage: e.lightPool.stats, cpuMs: m.cpuMs, renderMs: m.renderMs, otherMs: m.otherMs, throughputMs: m.throughputMs, worstCpuMs: m.worstCpuMs, programs: programs(e) };
      e.dispose(); return out;
    },
    /** A light added / removed in play: per-frame times around the change. variant: 'add' | 'remove' | 'toggle' (visible) | 'intensity' (the fix) */
    async lightsChurn({ base, variant }) {
      const e = await world(); const ls = [];
      for (let i = 0; i < base; i++) { const l = new THREE.PointLight(0xffc080, 60, 18, 2); l.position.set(...spot(i, base)); e.scene.add(l); ls.push(l); }
      const extra = new THREE.PointLight(0x80c0ff, 60, 18, 2); extra.position.set(0, 3, 0);
      if (variant === 'toggle' || variant === 'intensity') { extra.visible = variant === 'intensity'; extra.intensity = variant === 'intensity' ? 0 : 60; e.scene.add(extra); }
      await e.start(); e.haltLoop();
      for (let i = 0; i < 30; i++) frame(e); await gpuDone(e);
      const run = async () => { const t = performance.now(); frame(e); await gpuDone(e); return performance.now() - t; };
      const steady = []; for (let i = 0; i < 20; i++) steady.push(await run());
      const p0 = programs(e);
      if (variant === 'add') e.scene.add(extra); else if (variant === 'remove') e.scene.remove(ls[0]);
      else if (variant === 'toggle') extra.visible = true; else if (variant === 'intensity') extra.intensity = 60;
      const after = []; for (let i = 0; i < 12; i++) after.push(await run());
      const p1 = programs(e);
      const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
      const out = { base, variant, steadyMedMs: r2(med(steady)), firstFrameMs: r2(after[0]), afterMs: after.slice(1, 6).map(r2), maxAfterMs: r2(Math.max(...after)), programsBefore: p0, programsAfter: p1 };
      e.dispose(); return out;
    },
    /** Pool behaviour: a row of lamps, the camera (the pool's focus) walks along it; reads each slot light's intensity / position every frame */
    async lightsPoolEdge({ sources = 12, pool = 4 }) {
      const { lightPool } = await import('../../index.js');
      const e = await world(); e.use(lightPool({ point: pool, every: 0.1, fade: 0.3 }));
      for (let i = 0; i < sources; i++) e.lightPool.add({ x: -44 + i * 8, y: 3, z: 0 }, { intensity: 60, distance: 14, color: 0xffc080 });
      await e.start(); e.haltLoop(); e.camera.position.set(-44, 2, 6);
      const L = e.lightPool.lights, prev = L.map(l => ({ i: l.intensity, x: l.position.x })), st = L.map(() => ({ maxDI: 0, jumpsLit: 0, handovers: 0 }));
      let frames = 0, maxLit = 0, minLit = 99;
      for (let t = 0; t < 60 * 24; t++) {
        e.camera.position.x = -44 + (t / 60 / 24) * 88;
        e._fixedStep(); e._frameHooks(1 / 60); e._render(1 / 60); frames++;
        let lit = 0;
        L.forEach((l, k) => {
          const di = Math.abs(l.intensity - prev[k].i), dx = Math.abs(l.position.x - prev[k].x);
          st[k].maxDI = Math.max(st[k].maxDI, di);
          if (dx > 0.01) { st[k].handovers++; if (Math.max(l.intensity, prev[k].i) > 3) st[k].jumpsLit++; }   // moved while visibly lit (> 5% of 60) = a pop
          prev[k] = { i: l.intensity, x: l.position.x }; if (l.intensity > 3) lit++;
        });
        if (t > 60) { maxLit = Math.max(maxLit, lit); minLit = Math.min(minLit, lit); }   // skip the first second: the pool fades in
      }
      const out = { sources, pool, frames, perSlot: st.map(s => ({ maxIntensityStepPerFrame: r2(s.maxDI), handovers: s.handovers, movedWhileLit: s.jumpsLit })), litMax: maxLit, litMin: minLit, usage: e.lightPool.usage() };
      e.dispose(); return out;
    },
  };
}
