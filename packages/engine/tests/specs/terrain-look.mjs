// Terrain look open points (recipes/37-terrain-look-hooks.md): shading 'texture' (per-chunk color map), diagonal, normalFn, boundsPad.
// Defaults draw what they always drew (golden hashes computed with the code before these options existed); the river-bank check renders
// the real engine into a render target and measures the color border. Same format as specs.mjs.
const PAGE = '/tests/perf/index.html?mode=world';

export const specs = [
  {
    name: '[守] 地形外观：默认 smooth / flat 的 pos+nor+col+uv 逐位等于旧写法（含改动、variation、structuredClone）；texture / diagonal / normalFn / boundsPad 生效；接缝无缝；表面与网格一致',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createTerrain } = threedogTest, out = {};
        const base = { seed: 5, colors: { a: 0x4a7c3a, b: 0x6a9c4a, r: 0x777777, t: 0x553322 }, biomeColors: { default: ['a', 'b'], tilled: ['t'] }, steep: [{ maxNormalY: 0.7, colors: ['r'] }],
          height: '(x,z,n)=>n.fbm(x*0.02,z*0.02,3)*12', flatten: [{ x: 70, z: -100, radius: 20 }] };
        const hash = c => { let h = 0; for (const k of ['pos', 'nor', 'col', 'uv']) for (const v of c[k]) h = (h * 31 + Math.round(v * 1e6)) | 0; return h; };
        const EDITS = { h: [20, -30, 5, 21, -30, 2], t: [[22, -31, 'tilled'], [23, -31, 'tilled']] };
        for (const sh of ['smooth', 'flat']) {
          out[sh] = hash(createTerrain({ ...base, shading: sh }).buildChunk(1, -2));
          const e = createTerrain({ ...base, shading: sh }); e.setEdits(EDITS); out[sh + 'Edit'] = hash(e.buildChunk(1, -2));
          out[sh + 'Var'] = hash(createTerrain(structuredClone({ ...base, shading: sh, variation: { patches: { size: 60, strength: 0.3, levels: 3 } } })).buildChunk(1, -2));
        }
        // texture mode: colors come from the map; vertex colors are white; the config survives structuredClone
        const tcfg = { ...base, shading: 'texture', colorResolution: 100 };
        const A = createTerrain(tcfg).buildChunk(0, 0), A2 = createTerrain(structuredClone(tcfg)).buildChunk(0, 0);
        out.texWhite = A.col.every(v => v === 1);
        out.texClone = hash(A) === hash(A2) && A.tex.data.every((v, i) => v === A2.tex.data[i]) && A.tex.size === 102;
        // seam: the border pixels of a chunk equal the first pixels of its neighbor (both computed from world coordinates)
        const T = createTerrain(tcfg), B = T.buildChunk(1, 0).tex, C = T.buildChunk(0, 1).tex, S = A.tex.size, R = S - 2;
        let bad = 0;
        for (let j = 0; j < S; j++) for (let d = 0; d < 2; d++) for (let c = 0; c < 4; c++) if (A.tex.data[(j * S + R + d) * 4 + c] !== B.data[(j * S + d) * 4 + c]) bad++;
        for (let i = 0; i < S; i++) for (let d = 0; d < 2; d++) for (let c = 0; c < 4; c++) if (A.tex.data[((R + d) * S + i) * 4 + c] !== C.data[(d * S + i) * 4 + c]) bad++;
        out.seamBad = bad;
        // an edit (paint + raise) changes the pixels
        const te = createTerrain(tcfg), before = te.buildChunk(0, 0).tex.data.slice(); te.setEdits({ h: [3, 3, 20], t: [[2, 2, 'tilled']] });
        out.texEdit = te.buildChunk(0, 0).tex.data.some((v, i) => v !== before[i]);
        // normals: flat vs smooth lighting in texture mode; normalFn replaces the smooth normal
        out.normalsDiffer = createTerrain({ ...tcfg, normals: 'flat' }).buildChunk(0, 0).nor.some((v, i) => v !== A.nor[i]);
        const up = createTerrain({ ...base, shading: 'smooth', normalFn: '(i,j,h,c)=>[0,2,0]' }).buildChunk(0, 0).nor;
        out.normalFn = up.every((v, i) => i % 3 === 1 ? v === 1 : v === 0);
        out.normalFnFn = createTerrain({ ...base, normalFn: (i, j, h, c) => [0, 2, 0] }) !== null;
        // diagonal: engine.surface equals the mesh height at every triangle centroid, triangles face up
        out.diag = {};
        for (const diagonal of ['fixed', 'adaptive', 'alternate']) {
          const D = createTerrain({ ...base, diagonal, shading: 'flat' }), ch = D.buildChunk(-1, 2); let worst = 0, up2 = true;
          for (let t = 0; t < ch.pos.length; t += 9) {
            const P = [0, 3, 6].map(o => [ch.pos[t + o], ch.pos[t + o + 1], ch.pos[t + o + 2]]);
            worst = Math.max(worst, Math.abs(D.surface(-64 + (P[0][0] + P[1][0] + P[2][0]) / 3, 128 + (P[0][2] + P[1][2] + P[2][2]) / 3) - (P[0][1] + P[1][1] + P[2][1]) / 3));
            if ((P[1][2] - P[0][2]) * (P[2][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) <= 0) up2 = false;
          }
          out.diag[diagonal] = { worst, up2, h: hash(ch) };
        }
        const pad = createTerrain({ ...base, boundsPad: { up: 10 } }).buildChunk(0, 0).sphere, pad0 = createTerrain(base).buildChunk(0, 0).sphere;
        out.pad = [pad[1] - pad0[1], pad[3] - pad0[3]];
        out.errs = ['shading', 'diagonal', 'normals'].map(k => { try { createTerrain({ ...base, [k]: 'nope' }); return ''; } catch (e) { return e.message; } });
        return out;
      });
      // golden values: computed with the generator before shading 'texture', diagonal, normalFn and boundsPad existed
      check('默认 smooth / flat 区块 pos+nor+col+uv 哈希逐位等于旧写法', r.smooth === 707894586 && r.flat === 955529473, `${r.smooth} ${r.flat}`);
      check('带地形改动（抬高+涂色）的 smooth / flat 区块也逐位等于旧写法', r.smoothEdit === -596330878 && r.flatEdit === -669930689, `${r.smoothEdit} ${r.flatEdit}`);
      check('variation + structuredClone（worker 配置）后 smooth / flat 逐位等于旧写法', r.smoothVar === -1847899442 && r.flatVar === 429505983, `${r.smoothVar} ${r.flatVar}`);
      check('texture：顶点色全白；配置经 structuredClone 后贴图与网格逐位相同；贴图含 1 像素边（size = colorResolution + 2）', r.texWhite && r.texClone);
      check('texture：相邻区块的边缘像素逐字节相同（接缝无缝）', r.seamBad === 0, String(r.seamBad));
      check('texture：terrain.edit 等价的改动（抬高 + 涂色）后贴图像素变化', r.texEdit);
      check('texture：normals: flat 与 smooth 光照法线不同；normalFn（字符串与函数）替换平滑法线', r.normalsDiffer && r.normalFn && r.normalFnFn);
      check('diagonal fixed / adaptive / alternate：engine.surface 与网格三角形一致（误差 < 1e-5）、三角形朝上，且三种切法网格互不相同',
        Object.values(r.diag).every(d => d.worst < 1e-5 && d.up2) && new Set(Object.values(r.diag).map(d => d.h)).size === 3, JSON.stringify(r.diag));
      check('boundsPad：up / radius 增量进入包围球', Math.abs(r.pad[0] - 7) < 1e-9 && Math.abs(r.pad[1]) < 1e-9, JSON.stringify(r.pad));
      check('shading / diagonal / normals 写错值：报错列出可选值', r.errs.every(m => /must be '.*' \|/.test(m)), r.errs.join(' ; '));
    },
  },
  {
    name: '河岸：真实引擎渲染，resolution 16 下 texture 的地貌边界比 smooth 平滑得多；贴图随 terrain.edit 涂色更新；卸载释放贴图',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE } = threedogTest, T = engine.terrain, out = {};
        const OX = 2560, OZ = 2560;   // far from the example world's props: chunk (40, 40)
        const trueZ = x => OZ + 32 + 14 * Math.sin((x - OX) * 0.09);
        const cfgOf = shading => ({ seed: 3, chunkSize: 64, resolution: 16, waterLevel: -Infinity, flatten: [], heightmap: null, params: null, shading,
          colors: { A: 0xff0000, B: 0x0000ff, P: 0x00ff00 }, biomeColors: { a: ['A'], b: ['B'], paint: ['P'] }, steep: [], variation: { jitter: { min: 1, range: 0 } },
          height: '(x,z)=>0', groundType: `(x,z)=> z > ${OZ + 32} + 14*Math.sin((x - ${OX})*0.09) ? "a" : "b"` });
        const species = {}; for (const sp of engine.vegetation?.list() || []) species[sp.name] = sp.rule;
        engine.pause();
        engine.player.root.visible = false; T.setDensity(0);
        const cam = new THREE.OrthographicCamera(-32, 32, 32, -32, 1, 200); cam.position.set(OX + 32, 100, OZ + 32); cam.up.set(0, 0, -1); cam.lookAt(OX + 32, 0, OZ + 32);   // top-down over chunk (0, 0), x right, z down
        const N = 512, rt = new THREE.WebGLRenderTarget(N, N), R = engine.renderer;
        const wait = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) { engine.step(1 / 30, { describe: false }); await new Promise(res => setTimeout(res, 20)); } return fn(); };
        const shot = () => {
          const px = new Uint8Array(N * N * 4), keep = engine.scene.background, fog = engine.scene.fog;
          engine.scene.background = null; engine.scene.fog = null;
          R.setRenderTarget(rt); R.render(engine.scene, cam); R.readRenderTargetPixels(rt, 0, 0, N, N, px); R.setRenderTarget(null);
          engine.scene.background = keep; engine.scene.fog = fog;
          return px;
        };
        // boundary row per column: where red overtakes blue (image row 0 is the far edge = z 64 with this camera, so flip to z)
        const bank = px => {
          const all = [];
          for (let x = Math.ceil(6 / 64 * N); x <= Math.floor(58 / 64 * N); x++) {
            let z = NaN;
            for (let row = N - 1; row > 0; row--) {   // from z = 0 upwards (row N-1 is z ~ 0)
              const d = i => px[i * 4] - px[i * 4 + 2], a = d((row) * N + x), b = d((row - 1) * N + x);
              if (a < 0 && b >= 0) { z = OZ + ((N - 1 - row) + (0 - a) / (b - a) + 0.5) * 64 / N; break; }
            }
            all.push(z - trueZ(OX + (x + 0.5) * 64 / N));
          }
          const err = all.filter(e => !Number.isNaN(e));
          const rms = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / err.length);
          let s2 = 0; for (let i = 1; i < err.length - 1; i++) { const d = err[i - 1] - 2 * err[i] + err[i + 1]; s2 += d * d; }
          return { rms: +rms.toFixed(3), saw: +Math.sqrt(s2 / (err.length - 2)).toFixed(4), miss: all.filter(Number.isNaN).length };
        };
        for (const sh of ['smooth', 'texture']) {
          engine.terrain.reinit(cfgOf(sh), species);
          engine.player.placeAt({ x: OX + 32, z: OZ + 32 });
          out[sh + 'Ready'] = await wait(() => engine.terrain.isReadyAround({ x: OX + 32, z: OZ + 32 }));
          for (let i = 0; i < 3; i++) engine.step(1 / 30, { describe: false });
          out[sh] = bank(shot());
        }
        // texture mode + style.seasons.mode 'mix': the season tint must land on the mapped color (not be multiplied back by the map)
        const U = engine.uniforms, at = (Math.round(N * 0.1) * N + N / 2) * 4, lo = p => +(Math.min(p[at], p[at + 1], p[at + 2]) / Math.max(1, p[at], p[at + 1], p[at + 2])).toFixed(2);   // whiteness: lowest / highest channel
        const plain = lo(shot());
        U.uGroundTint.value.set(0xffffff); U.uGroundMix.value = 0.8;
        engine.step(1 / 30, { describe: false });
        out.snowMix = [plain, lo(shot())];
        U.uGroundMix.value = 0;
        // texture mode now: material per chunk, texture size, paint refreshes it, dispose frees it
        const c = T.chunks.get('40,40'), tex = c.colorTex;
        out.mount = !!tex && tex.image.width === 130 && tex.colorSpace === THREE.SRGBColorSpace && c.terrain.material === c.colorMat && c.colorMat !== T.terrainMat;
        const before = tex.image.data.slice();
        engine.terrain.edit({ x: OX + 32, z: OZ + 20 }, { shape: 'square', radius: 6, paint: 'paint' });
        out.paintChanged = c.colorTex === tex && tex.image.data.some((v, i) => v !== before[i]);
        for (let i = 0; i < 3; i++) engine.step(1 / 30, { describe: false });
        const px = shot(), mid = (Math.round((64 - 20) / 64 * N) * N + Math.round(32 / 64 * N)) * 4;
        out.paintGreen = px[mid + 1] > 30 && px[mid + 1] > 3 * px[mid] && px[mid + 1] > 3 * px[mid + 2];   // the painted square renders green
        out.paintPx = Array.from(px.slice(mid, mid + 4)).join(',');
        let disposed = 0; tex.addEventListener('dispose', () => disposed++);
        engine.terrain.reinit(cfgOf('smooth'), species);
        out.disposed = disposed === 1;
        engine.resume(); rt.dispose();
        return out;
      });
      check('texture 与 smooth 都在 resolution 16 下加载出区块', r.smoothReady && r.textureReady);
      check(`河岸（曲线地貌边界）渲染后偏离真实曲线的均方根：texture ${r.texture.rms} m 对 smooth ${r.smooth.rms} m（须小于 1/3）`, r.texture.miss === 0 && r.smooth.miss === 0 && r.texture.rms * 3 < r.smooth.rms, JSON.stringify(r));
      check(`河岸锯齿度（边界误差二阶差分均方根）：texture ${r.texture.saw} 对 smooth ${r.smooth.saw}（须小于 1/2）`, r.texture.saw * 2 < r.smooth.saw, JSON.stringify(r));
      check('texture 区块：每块自己的材质 + 130px sRGB 贴图', r.mount);
      check('texture + 季节 mix（白色 0.8）：顶面像素明显向白色偏', r.snowMix[0] < 0.1 && r.snowMix[1] > 0.5, JSON.stringify(r.snowMix));
      check('terrain.edit 涂色后同一张贴图被更新，渲染出涂的颜色', r.paintChanged && r.paintGreen, `${r.paintChanged} ${r.paintGreen} ${r.paintPx}`);
      check('区块重建时贴图被释放（dispose 事件）', r.disposed);
    },
  },
];
