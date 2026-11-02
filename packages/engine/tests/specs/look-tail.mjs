// 画面架构第一阶段收尾（docs/plans/done/2026-11-02-look-architecture.md）的"不许绕开"检查。
// Same format as specs.mjs; appended at the end of specs.mjs.
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

export const specs = [
  {
    // 一页里两份引擎：各自在 Mesh.prototype 上装阴影访问器，后装的让先装那份的风/CSM 材质阴影不对，而且不报错。
    // 所以加载时登记到全局符号，第二份（不同路径）警告一次。热更新是同一路径带 ?t=，不算两份。
    name: '[guard] engine copies: a second engine copy on the page warns once naming both paths and the dedupe fix; hot reload is not a copy',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      // 测试页跑的是打包产物，拿不到源码模块：页面里只读全局登记，纯函数在 node 里测（copies.js 不依赖浏览器）
      const real = await ev(async () => { await engine.loading.settled(); return globalThis[Symbol.for('threedog.engine.copies')] ?? []; });
      const m = await import('../../core/copies.js');
      const reg = {};
      const first = m.noteCopy({ version: '0.2.1', url: 'http://h/node_modules/threedog/render/patches.js' }, reg);
      const hot = m.noteCopy({ version: '0.2.1', url: 'http://h/node_modules/threedog/render/patches.js?t=123' }, reg);
      const second = m.noteCopy({ version: '0.1.0', url: 'http://h/packages/engine/render/patches.js' }, reg);
      const r = { real, first, hot, second };
      // 真实页面上引擎自己登记了（证明 patches.js 真的调了 noteCopy，而不是只有一个没人调的函数）
      check('the engine on this page recorded itself (render/patches.js calls noteCopy at load)', r.real.length === 1 && /\/$/.test(r.real[0].root), JSON.stringify(r.real));
      check('first copy and a hot reload of it: no warning', r.first === '' && r.hot === '', JSON.stringify([r.first, r.hot]));
      check('a second copy at another path: one warning with both versions + paths, the dedupe line first, and the code',
        r.second.includes('0.2.1 at http://h/node_modules/threedog/') && r.second.includes('0.1.0 at http://h/packages/engine/') &&
        /load one, e\.g\. vite\.config\.js: resolve: \{ dedupe:/.test(r.second) && r.second.endsWith('[engine-two-copies]'), r.second);
      const ver = JSON.parse(read('package.json')).version, src = read('core/copies.js');
      check('core/copies.js VERSION equals package.json version (the warning names real versions)', src.includes(`export const VERSION = '${ver}'`), ver);
    },
  },
  {
    // 生成器自己设的阴影开关要留着（地毯只接收不投射）；清单项 castShadow 统一改；什么都没设才给默认的投射+接收。
    // 内容摆件和 assets.model 走同一个 shadowDefaults，源码扫描保证不再自己强行写 true。
    // 按名字建模型的那条路在 ae04bac9 搬到了 core/namedModel.js（content/models.js 只转调它），所以两个文件都查。
    name: '[guard] shadow flags: a generator keeps its own castShadow / receiveShadow, the manifest entry sets them, none set = cast + receive; content props use the same rule',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        const T = engine.THREE, box = () => new T.Mesh(new T.BoxGeometry(1, 0.1, 1), new T.MeshStandardMaterial());
        engine.assets.manifest({ name: 'shadowTest', models: {
          shRug: function () { const g = new T.Group(), m = box(); m.receiveShadow = true; g.add(m, box()); return g; },
          shPlain: function () { const g = new T.Group(); g.add(box(), box()); return g; },
          shOff: { build: function () { const g = new T.Group(); g.add(box()); return g; }, castShadow: false },
        } });
        const flags = async n => { const o = await engine.assets.model(n), out = []; o.traverse(x => { if (x.isMesh) out.push([x.castShadow, x.receiveShadow]); }); return out; };
        return { rug: await flags('shRug'), plain: await flags('shPlain'), off: await flags('shOff') };
      });
      check('a generator that set receiveShadow on a mesh keeps its flags (no cast forced on)', JSON.stringify(r.rug) === '[[false,true],[false,false]]', JSON.stringify(r.rug));
      check('a generator that set nothing: every mesh casts and receives', JSON.stringify(r.plain) === '[[true,true],[true,true]]', JSON.stringify(r.plain));
      check('{ build, castShadow: false } in the manifest: no mesh casts (receive still the default)', JSON.stringify(r.off) === '[[false,true]]', JSON.stringify(r.off));
      const named = read('core/namedModel.js'), models = read('modules/content/models.js'), forced = /castShadow\s*=\s*\w+\.receiveShadow\s*=\s*true/;
      check('content props go through shadowDefaults (core/namedModel.js; no forced castShadow = receiveShadow = true there or in content/models.js)',
        named.includes('shadowDefaults(p,') && !forced.test(named) && !forced.test(models) && /from '\.\.\/\.\.\/core\/namedModel\.js'/.test(models));
    },
  },
  {
    // 代码生成的贴图按名注册（函数或 Texture 实例），取回的就是那一张；材质规格里传进来的贴图保留自己的 repeat / wrap，
    // 规格写了才改，而且改在副本上；每个槽可以写 { texture, channel }（aoMap / lightMap 用第二套 uv）
    name: '[guard] textures: code textures registered by name come back as made; a passed Texture keeps its own repeat / wrap; per-slot { texture, channel }',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        const T = engine.THREE;
        let builds = 0;
        const inst = new T.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); inst.needsUpdate = true; inst.repeat.set(2, 2);
        engine.assets.manifest({ name: 'texTest', textures: {
          tGen: () => { builds++; const t = new T.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1); t.wrapS = t.wrapT = T.ClampToEdgeWrapping; t.repeat.set(3, 3); t.needsUpdate = true; return t; },
          tInst: inst,
        } });
        const g1 = await engine.assets.texture('tGen'), g2 = await engine.assets.texture('tGen', { color: false });
        const byName = engine.makeMaterial('default', { type: 'standard', map: 'tGen', roughnessMap: 'tInst' });
        for (let i = 0; i < 20 && (byName.map === null || !byName.map.repeat || byName.map.repeat.x !== 3); i++) await new Promise(res => setTimeout(res, 20));
        const kept = engine.makeMaterial('default', { type: 'standard', map: inst });
        const over = engine.makeMaterial('default', { type: 'standard', map: inst, repeat: 5 });
        const ch = engine.makeMaterial('default', { type: 'standard', aoMap: { texture: inst, channel: 1 } });
        let bad = ''; try { engine.makeMaterial('default', { type: 'standard', aoMap: { texture: inst, chanel: 1 } }); } catch (e) { bad = e.message; }
        return {
          same: g1 === g2, builds, inst: (await engine.assets.texture('tInst')) === inst,
          byName: { repeat: byName.map.repeat.x, clamp: byName.map.wrapS === T.ClampToEdgeWrapping, inst: byName.roughnessMap === inst },
          kept: kept.map === inst && inst.repeat.x === 2, over: { copy: over.map !== inst, repeat: over.map.repeat.x, instRepeat: inst.repeat.x, sameImage: over.map.source === inst.source },
          ch: { channel: ch.aoMap.channel, instChannel: inst.channel }, bad,
        };
      });
      check('a function under manifest textures runs once and is the texture by that name (no per-option variant, no URL fetch)', r.same && r.builds === 1, JSON.stringify(r));
      check('a Texture under manifest textures is returned as is', r.inst, JSON.stringify(r));
      check("map: 'tGen' gets the generated texture with its own repeat 3 and clamp wrap (no default 'repeat' forced)", r.byName.repeat === 3 && r.byName.clamp && r.byName.inst, JSON.stringify(r.byName));
      check('map: myTexture with no repeat / wrap in the spec: that very texture, its repeat untouched', r.kept, JSON.stringify(r));
      check('map: myTexture, repeat: 5: a copy (same image) gets repeat 5, yours keeps 2', r.over.copy && r.over.repeat === 5 && r.over.instRepeat === 2 && r.over.sameImage, JSON.stringify(r.over));
      check('aoMap: { texture, channel: 1 } reads uv1 on a copy; a typo throws with an example', r.ch.channel === 1 && r.ch.instChannel === 0 && /not a texture setting.*Example: aoMap: \{ texture: 'ao', channel: 1 \}/.test(r.bad), JSON.stringify([r.ch, r.bad]));
    },
  },
  {
    // 游戏自己的地面材质：replace(m, { effects: false }) 原样用，不打云影 / 季节 / 细节补丁（和 vegetation.define({ effects: false }) 同一个词）
    name: '[guard] ground.replace(material, { effects: false }): drawn as given with no engine patch; without it the patches are added; an unknown option throws',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        const T = engine.THREE, g = engine.look.ground, cur = () => g._spec.object();
        const patched = m => !!Object.getOwnPropertyDescriptor(m, 'onBeforeCompile')?.get;
        const bare = new T.MeshStandardMaterial({ color: 0x6a8a4a }), fx = new T.MeshStandardMaterial({ color: 0x6a8a4a });
        g.replace(bare, { effects: false, owner: 'groundTest' }); engine.step(0.05);
        const a = { same: cur() === bare, patched: patched(bare) };
        g.replace(fx, { owner: 'groundTest' }); engine.step(0.05);
        const b = { same: cur() === fx, patched: patched(fx) };
        let bad = ''; try { g.replace(fx, { effect: false }); } catch (e) { bad = e.message; }
        g._clear('groundTest'); engine.step(0.05);
        return { has: !!g, a, b, bad, back: cur() !== fx && cur() !== bare };
      });
      check('effects: false: the ground material is yours, unpatched', r.has && r.a.same && !r.a.patched, JSON.stringify(r));
      check('without it: cloud shadow / season patches are added', r.b.same && r.b.patched, JSON.stringify(r.b));
      check('a misspelled option throws naming the options', /options are owner, effects/.test(r.bad), r.bad);
      check("clear gives the style's material back", r.back, JSON.stringify(r));
    },
  },
  {
    // terrain({ material, effects: false }) 和 look.ground.replace(m, { effects: false }) 是同一个开关：游戏自己的地面材质建块时也不被打补丁
    name: '[guard] terrain({ material, effects: false }): the game material is used untouched at build; without effects it is patched; effects alone throws',
    url: '/tests/terrain-edit/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine, terrain, THREE } = window.threedogTerrain;
        const patched = m => !!Object.getOwnPropertyDescriptor(m, 'onBeforeCompile')?.get;
        const make = async (opts, key) => {
          const E = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'terrain-fx-' + key });
          E.use(terrain({ seed: 7, viewChunks: 1, ...opts })); await E.start();
          for (let i = 0; i < 600 && !E.terrain.isReadyAround({ x: 0, z: 0 }); i++) { E.step(1 / 60); await new Promise(res => setTimeout(res, 5)); }
          return E;
        };
        const bare = new THREE.MeshStandardMaterial({ color: 0x6a8a4a }), fx = new THREE.MeshStandardMaterial({ color: 0x6a8a4a });
        const A = await make({ material: bare, effects: false }, 'a'), B = await make({ material: fx }, 'b');
        const out = { a: { same: A.look.ground._spec.object() === bare, patched: patched(bare), mesh: A.terrain.chunks.get('0,0')?.terrain?.material === bare },
          b: { same: B.look.ground._spec.object() === fx, patched: patched(fx) } };
        try { terrain({ effects: false }); } catch (e) { out.bad = e.message; }
        A.dispose(); B.dispose();
        return out;
      });
      check('effects: false: chunks draw the game material as given, never patched', r.a.same && !r.a.patched && r.a.mesh, JSON.stringify(r.a));
      check('without it the cloud shadow / season patches are added (unchanged default)', r.b.same && r.b.patched, JSON.stringify(r.b));
      check('effects without a material throws with the one-line fix', /terrain\(\{ material: myMaterial, effects: false \}\)/.test(r.bad || ''), r.bad);
    },
  },
  {
    // 烘焙 / 开发缓存的保真：贴图强度（aoMapIntensity、normalScale ...）经 GLB 往返保留；glTF 放不下的槽（lightMap、specularMap、
    // 手做的 toon 渐变图）在写文件前警告一次，点名模型和槽，并给出 cache: false 的原文
    name: '[guard] bake fidelity: map strengths survive the GLB round trip (role and plain materials); lightMap / specularMap / hand-made gradientMap warn once with cache: false',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, toGLB } = threedogTest;
        await engine.loading.settled();
        const cv = c => { const el = document.createElement('canvas'); el.width = el.height = 2; const x = el.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 2, 2); return new THREE.CanvasTexture(el); };   // the exporter needs an image, not raw data
        const ao = cv('#c8c8c8');
        const nrm = cv('#8080ff');
        const role = engine.makeMaterial('bakeFid', { type: 'standard', aoMap: ao, aoMapIntensity: 0.4, normalMap: nrm, normalScale: new THREE.Vector2(0.3, 0.6) });
        const plain = new THREE.MeshStandardMaterial({ aoMap: ao, aoMapIntensity: 0.25, normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5) });
        const root = new THREE.Group(), a = new THREE.Mesh(new THREE.BoxGeometry(), role), b = new THREE.Mesh(new THREE.BoxGeometry(), plain);
        a.name = 'role'; b.name = 'plain'; root.add(a, b);
        const url = URL.createObjectURL(new Blob([await toGLB(root, engine, 'fid')], { type: 'model/gltf-binary' })) + '#fid.glb';
        const back = await engine.assets.model(url), ra = back.getObjectByName('role').material, rb = back.getObjectByName('plain').material;
        const lit = new THREE.MeshToonMaterial({ gradientMap: ao, lightMap: ao });
        const w = await __t.warns(async () => { await toGLB(new THREE.Mesh(new THREE.BoxGeometry(), lit), engine, 'toonSign'); await toGLB(new THREE.Mesh(new THREE.BoxGeometry(), lit), engine, 'toonSign'); });
        return { role: [ra.aoMapIntensity, ra.normalScale.x, ra.normalScale.y, ra.userData.purpose], plain: [rb.aoMapIntensity, rb.normalScale.x], warns: w.warns.filter(s => s.includes("'toonSign'")) };
      });
      check('a makeMaterial role keeps aoMapIntensity 0.4 and normalScale (0.3, 0.6) after the round trip', JSON.stringify(r.role) === '[0.4,0.3,0.6,"bakeFid"]', JSON.stringify(r.role));
      check('a plain three.js material keeps aoMapIntensity 0.25 and normalScale 0.5', Math.abs(r.plain[0] - 0.25) < 1e-6 && Math.abs(r.plain[1] - 0.5) < 1e-6, JSON.stringify(r.plain));
      check('lightMap + a hand-made gradientMap: exactly one warning naming the model, the slots and { build, cache: false }',
        r.warns.length === 1 && /lightMap/.test(r.warns[0]) && /gradientMap/.test(r.warns[0]) && r.warns[0].includes('toonSign: { build, cache: false }'), JSON.stringify(r.warns));
    },
  },
  {
    // 没有天空模块时，基线太阳的阴影框跟着 engine.focus 走；游戏自己摆 sun.target 就让开（同一个 'shadow.follow' 登记）
    name: '[guard] baseline shadow follow (no sky): registered as shadow.follow, yields to the game placing sun.target, look.lights.manual hands it back',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause(); engine.step(0.05);
        const sun = engine.lights.sun, row0 = engine.describe().owned?.['shadow.follow'];
        engine.focus.set(3, 0, 3); engine.step(0.05);
        const followed = sun.target.position.x;
        const w = await __t.warns(() => { sun.target.position.x = 777; engine.focus.set(9, 0, 9); engine.step(0.05); engine.step(0.05); });
        const a = { x: sun.target.position.x, by: engine.describe().owned['shadow.follow'].writer, warns: w.warns.filter(s => s.includes('shadow.follow')).length };
        engine.look.lights.manual('shadow.follow', false); engine.step(0.05); engine.step(0.05);
        return { castShadow: sun.castShadow, part: row0?.part, followed, a, back: sun.target.position.x };
      });
      check('the baseline sun casts and its follow is registered on look.lights', r.castShadow && r.part === 'lights', JSON.stringify(r));
      check('it follows engine.focus', r.followed === 3, JSON.stringify(r));
      check('the game sets sun.target: the engine yields, value stays, one warning naming the takeover', r.a.x === 777 && /yielded/.test(r.a.by) && r.a.warns === 1, JSON.stringify(r.a));
      check("look.lights.manual('shadow.follow', false): follows the focus again", r.back === 9, JSON.stringify(r));
    },
  },
  {
    // 关掉天空的环境图时，回到 look.lights 的房间环境图（基线 PBR 金属不变黑），而不是空
    name: '[guard] env: turning the sky environment off brings back the room map of look.lights env.intensity; batching says what it did',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const hL = engine.look.lights.set({ env: { intensity: 0.7 } }, { owner: 'envTest' });
        engine.look.env.replace('sky', { owner: 'envTest' });
        engine.step(0.05); if (engine.sky._env) engine.sky._env.deferred = true; engine.sky._envFrame(1e4);
        const skyMap = engine.scene.environment;
        const hE = engine.look.env.replace(false, { owner: 'envTest' });
        const out = { skyMap: !!skyMap && skyMap !== engine._roomEnv?.texture, room: engine.scene.environment === engine._roomEnv?.texture, i: engine.scene.environmentIntensity, scale: engine._roomScale,
          by: engine.describe().owned?.env?.writer };
        hE.remove(); hL.remove();
        // batching: 12 copies of one game mesh opted in (userData.batch = true) in one cell -> a batch, and stats carries the note
        const T = engine.THREE, g = new T.BoxGeometry(0.3, 0.3, 0.3), m = new T.MeshStandardMaterial();
        for (let i = 0; i < 12; i++) { const x = new T.Mesh(g, m); x.position.set(500 + i * 0.5, 0, 500); x.userData.batch = true; engine.add(x); }
        engine.step(0.05); engine.step(0.05);
        out.batch = engine.batching.stats;
        return out;
      });
      check('the sky map was there, then replace(false) put the room map back at look.lights env.intensity (x the ambient scale of the hour)', r.skyMap && r.room && r.scale > 0 && Math.abs(r.i - 0.7 * r.scale) < 1e-6, JSON.stringify(r));
      check('that is the engine\'s own write: env stays engine-owned (no yield)', r.by === 'engine', JSON.stringify(r));
      check('describe().batching / batching.stats carries the note (raycast, opt out, off) while anything is batched',
        r.batch.batches > 0 && /batching\.item\(hit\.object, hit\.instanceId\)/.test(r.batch.note) && /userData\.batch = false/.test(r.batch.note), JSON.stringify(r.batch));
    },
  },
];
