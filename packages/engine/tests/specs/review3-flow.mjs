// 第三次审查，优先项 4、5：探针、过场和暂停。
const url = '/?threedog-headless';
const pump = `let src = null; engine.scene.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material)) src ??= o; }); const THREE = { Mesh: src.constructor, BoxGeometry: src.geometry.constructor, MeshBasicMaterial: src.material.constructor, MeshStandardMaterial: src.material.constructor, Vector3: engine.player.position.constructor }; const pump = (p, ms = 4000) => { let on = true; const t0 = Date.now(); const go = () => { if (!on) return; engine.step(1 / 60); if (Date.now() - t0 < ms) setTimeout(go, 1); }; go(); return Promise.race([Promise.resolve(p).then(v => (on = false, { v }), e => (on = false, { e: e.message })), new Promise(r => setTimeout(() => (on = false, r('open')), ms + 50))]); };`;
const inPage = (ev, body) => ev(new Function(`return (async () => { ${pump}\n${body} })()`));

export const specs = [
  {
    name: 'review3 flow: a transition that throws gives the screen and the controls back; two at once both end',
    url: '/tests/review3-docs/index.html',
    async run({ check, ev }) {
      await ev(async () => { window.engine = await window.freshKitchen(); window.engine.use(window.TD.flow()); });
      const r = await inPage(ev, `
        const look = () => ({ frozen: engine.frozen, phase: engine.flow.busy ?? null });
        const before = look();
        const bad = await pump(engine.flow.transition(() => { throw new Error('r3 boom'); }, { fade: 0.05 }));
        const after = look();
        const a = engine.flow.transition(() => {}, { fade: 0.05 }), b = engine.flow.transition(() => {}, { fade: 0.05 });
        const two = await pump(Promise.allSettled([a, b]));
        return { before, bad, after, two: two === 'open' ? 'open' : two.v.map(x => x.status), end: look() };
      `);
      const J = JSON.stringify(r);
      check('the throw reaches the caller', !!r.bad?.e, J);
      check('frozen state is back', r.after.frozen === r.before.frozen, J);
      check('two transitions both settle', r.two !== 'open', J);
      check('frozen state is back after two', r.end.frozen === r.before.frozen, J);
    },
  },
  {
    name: '[guard] probes: bad grids are refused quickly, a bake removes cleanly and a bake round-trips through JSON',
    url,
    timeout: 60000,
    software: true,
    async run({ check, ev }) {
      const r = await inPage(ev, `
        const out = {};
        const tryIt = async (k, o) => { try { const p = await Promise.race([engine.bakeProbes(o), new Promise((_, n) => setTimeout(() => n(new Error('TIMEOUT')), 8000))]); out[k] = 'accepted'; p?.remove?.(); } catch (e) { out[k] = e.message.slice(0, 70); } };
        await tryIt('zero', { bounds: { min: [-1, 0, -1], max: [1, 1, 1] }, spacing: 0 });
        await tryIt('neg', { bounds: { min: [1, 1, 1], max: [-1, 0, -1] }, spacing: 2 });
        await tryIt('nan', { bounds: { min: [NaN, 0, 0], max: [1, 1, 1] }, spacing: 2 });
        for (const j of [null, {}, { resolution: [1e6, 1e6, 1e6] }, 'x']) { try { const p = engine.loadProbes(j); out['load' + JSON.stringify(j)] = 'accepted'; p?.remove?.(); } catch (e) { out['load' + JSON.stringify(j)] = 'refused'; } }
        const m0 = { ...engine.renderer.info.memory };
        const p = await engine.bakeProbes({ bounds: { min: [-4, 0, -4], max: [4, 4, 4] }, spacing: 4 });
        const raw = p.toJSON(), j = JSON.parse(JSON.stringify(raw)); window.__bad = { keys: Object.keys(raw), halfType: raw.half?.constructor?.name, halfLen: raw.half?.length, sample: typeof raw.half === 'string' ? raw.half.slice(0, 16) : Array.from(raw.half ?? []).slice(0, 6) }; let s1 = p.sample(new THREE.Vector3(0, 1, 0));
        const sh = p.sh, nonFinite = sh ? Array.from(sh).filter(v => !Number.isFinite(v)).length : -1; window.__bad.nonFinite = nonFinite; window.__bad.shLen = sh?.length;
        p.remove();
        let b = null, loadErr = null; try { const q = engine.loadProbes(j); q.remove(); } catch (e) { loadErr = e.message; }
        for (let i = 0; i < 3; i++) engine.step(1 / 60);
        const m1 = { ...engine.renderer.info.memory };
        const left = []; engine.scene.traverse(o => { if (o.isLightProbeGrid || /ProbeGrid/.test(o.type ?? '')) left.push(o.type); });
        return { out, m0, m1, a: null, b, left, loadErr, bad: window.__bad };
      `);
      const J = JSON.stringify(r).slice(0, 700);
      check('bad bakes refused', ['zero', 'neg', 'nan'].every(k => r.out[k] !== 'accepted' && !/^TIMEOUT/.test(r.out[k])), J);
      check('bad files refused', Object.keys(r.out).filter(k => k.startsWith('load')).every(k => r.out[k] === 'refused'), J);
      check('no grid left in the scene', !r.left.length, J);
      check('a bake of this world loads back from its own file (recipe 34)', !r.loadErr && r.bad.nonFinite === 0, r.loadErr + ' ' + JSON.stringify(r.bad));
    },
  },
  {
    // Software rasterizers lose the slopes of a triangle with a vertex exactly on the camera plane: normalize(cross(dFdx, dFdy)) is NaN on any flat-shaded mesh under a
    // hemisphere light (plain three.js shows it too). Grids and meshes both sit on round numbers, so this page's default water met it on every axis line of the grid.
    name: '[guard] probes: a grid on the round numbers a mesh has its vertices on does not lose its axis lines',
    url,
    timeout: 60000,
    software: true,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const warns = [], orig = console.warn;
        console.warn = (...a) => { warns.push(a.join(' ')); orig(...a); };
        try {
          const p = await engine.bakeProbes({ bounds: { min: [-4, 0, -4], max: [4, 4, 4] }, spacing: 4 });
          const spread = p.sh.reduce((s, v) => s + Math.abs(v), 0) / p.sh.length;
          p.remove();
          return { filled: warns.map(w => /(\d+) probe\(s\)[^]*probes-check/.exec(w)?.[1]).filter(Boolean).map(Number), spread, flat: engine.water.material.flatShading };
        } finally { console.warn = orig; }
      });
      check('the water on this page is the flat-shaded default', r.flat, JSON.stringify(r));
      // 9 of the 18 before the grid moved off the vertices. A lone sliver pixel at a face's edge can still lose its slopes on software rendering (fillBroken takes that one)
      check('at most a stray probe needed its neighbours', (r.filled[0] ?? 0) <= 2 && r.spread > 0, JSON.stringify(r));
    },
  },
  {
    name: "[guard] probes: a game's material writing NaN costs the probe that saw it, not the bake, and the file loads",
    url,
    timeout: 60000,
    software: true,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const THREE = window.__threedogThree;
        // seen from inside only, so one probe alone sees it: what a broken shader in a closed room does
        const bad = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: { u: { value: -1 } }, fragmentShader: 'uniform float u; void main() { gl_FragColor = vec4(sqrt(u)); }' }));
        bad.position.set(0, 4, 0); engine.scene.add(bad);
        const p = await engine.bakeProbes({ bounds: { min: [-4, 0, -4], max: [4, 4, 4] }, spacing: 4 });
        const at = new THREE.Vector3(), per = p.sh.length / p.count, nonFinite = Array.from(p.sh).filter(v => !Number.isFinite(v)).length;
        let i = 0; while (p.point(i, at).distanceTo(bad.position) > 1e-3) i++;
        const dc = p.sh[i * per], j = JSON.parse(JSON.stringify(p.toJSON()));
        p.remove(); bad.removeFromParent();
        let loadErr = null; try { engine.loadProbes(j).remove(); } catch (e) { loadErr = e.message; }
        return { nonFinite, dc, loadErr };
      });
      const J = JSON.stringify(r);
      check('every number is finite and the file loads', r.nonFinite === 0 && !r.loadErr, J);
      check('the broken probe holds light, not a zero', r.dc > 0, J);
    },
  },
];
