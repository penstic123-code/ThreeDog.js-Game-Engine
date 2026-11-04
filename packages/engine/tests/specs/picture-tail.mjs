// 画面架构第一阶段收尾（docs/plans/done/2026-11-02-look-architecture.md）的"不许绕开"检查。
// Same format as the other files here.
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
        return {
          same: g1 === g2, builds, inst: (await engine.assets.texture('tInst')) === inst,
          own: { repeat: g1.repeat.x, clamp: g1.wrapS === T.ClampToEdgeWrapping, instRepeat: inst.repeat.x },
        };
      });
      check('a function under manifest textures runs once and is the texture by that name (no per-option variant, no URL fetch)', r.same && r.builds === 1, JSON.stringify(r));
      check('a Texture under manifest textures is returned as is', r.inst, JSON.stringify(r));
      check('a texture made in code keeps its own repeat and wrap (no default forced)', r.own.repeat === 3 && r.own.clamp && r.own.instRepeat === 2, JSON.stringify(r.own));
    },
  },
  {
    // 烘焙 / 开发缓存的保真：贴图强度（aoMapIntensity、normalScale ...）经 GLB 往返保留；glTF 放不下的槽（lightMap、specularMap、
    // 手做的 toon 渐变图）在写文件前警告一次，点名模型和槽，并给出 cache: false 的原文
    name: '[guard] bake fidelity: map strengths survive the GLB round trip (role and plain materials); lightMap / specularMap / gradientMap warn once with cache: false',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, toGLB } = threedogTest;
        await engine.loading.settled();
        const cv = c => { const el = document.createElement('canvas'); el.width = el.height = 2; const x = el.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 2, 2); return new THREE.CanvasTexture(el); };   // the exporter needs an image, not raw data
        const ao = cv('#c8c8c8');
        const nrm = cv('#8080ff');
        const role = new THREE.MeshStandardMaterial({ aoMap: ao, aoMapIntensity: 0.4, normalMap: nrm, normalScale: new THREE.Vector2(0.3, 0.6) });
        role.userData.purpose = 'bakeFid';
        const plain = new THREE.MeshStandardMaterial({ aoMap: ao, aoMapIntensity: 0.25, normalMap: nrm, normalScale: new THREE.Vector2(0.5, 0.5) });
        const root = new THREE.Group(), a = new THREE.Mesh(new THREE.BoxGeometry(), role), b = new THREE.Mesh(new THREE.BoxGeometry(), plain);
        a.name = 'role'; b.name = 'plain'; root.add(a, b);
        const url = URL.createObjectURL(new Blob([await toGLB(root, 'fid')], { type: 'model/gltf-binary' })) + '#fid.glb';
        const back = await engine.assets.model(url), ra = back.getObjectByName('role').material, rb = back.getObjectByName('plain').material;
        const lit = new THREE.MeshToonMaterial({ gradientMap: ao, lightMap: ao });
        const w = await __t.warns(async () => { await toGLB(new THREE.Mesh(new THREE.BoxGeometry(), lit), 'toonSign'); await toGLB(new THREE.Mesh(new THREE.BoxGeometry(), lit), 'toonSign'); });
        return { role: [ra.aoMapIntensity, ra.normalScale.x, ra.normalScale.y, ra.userData.purpose], plain: [rb.aoMapIntensity, rb.normalScale.x], warns: w.warns.filter(s => s.includes("'toonSign'")) };
      });
      check('a material with a role keeps aoMapIntensity 0.4 and normalScale (0.3, 0.6) after the round trip', JSON.stringify(r.role) === '[0.4,0.3,0.6,"bakeFid"]', JSON.stringify(r.role));
      check('a plain three.js material keeps aoMapIntensity 0.25 and normalScale 0.5', Math.abs(r.plain[0] - 0.25) < 1e-6 && Math.abs(r.plain[1] - 0.5) < 1e-6, JSON.stringify(r.plain));
      check('lightMap + a gradientMap: exactly one warning naming the model, the slots and { build, cache: false }',
        r.warns.length === 1 && /lightMap/.test(r.warns[0]) && /gradientMap/.test(r.warns[0]) && r.warns[0].includes('toonSign: { build, cache: false }'), JSON.stringify(r.warns));
    },
  },
  {
    // 没有天空模块时，基线太阳的阴影框跟着 engine.focus 走；游戏自己摆 sun.target 就让开（同一个 'shadow.follow' 登记）
    name: '[guard] baseline shadow follow (no sky): registered as shadow.follow, yields to the game placing sun.target, a box on the sun takes it back',
    url: '/tests/lights/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause(); engine.step(0.05);
        const sun = engine.lights.sun, row0 = engine.describe().owned?.['shadow.follow'];
        engine.focus.set(3, 0, 3); engine.step(0.05);
        const followed = sun.target.position.x;
        // a sun the game placed keeps its offset from the target while the box follows (the engine used to write a fixed offset over it)
        sun.position.set(sun.target.position.x + 7, 38, sun.target.position.z + 5); engine.focus.set(6, 0, 6); engine.step(0.05);
        const offset = [sun.position.x - sun.target.position.x, sun.position.y - sun.target.position.y, sun.position.z - sun.target.position.z];
        const w = await __t.warns(() => { sun.target.position.x = 777; engine.focus.set(9, 0, 9); engine.step(0.05); engine.step(0.05); });
        const a = { x: sun.target.position.x, by: engine.describe().owned['shadow.follow'].writer, warns: w.warns.filter(s => s.includes('shadow.follow')).length, says: w.warns.find(s => s.includes('shadow.follow')) };
        engine.shadows.box(sun, { follow: 'focus' }); engine.step(0.05); engine.step(0.05);
        return { castShadow: sun.castShadow, part: row0?.part, followed, offset, a, back: sun.target.position.x };
      });
      check('a sun the game placed keeps its offset from the target while the box follows', r.offset.join() === '7,38,5', JSON.stringify(r));
      check('the baseline sun casts and its follow is registered as a shadow row', r.castShadow && r.part === 'shadow', JSON.stringify(r));
      check('it follows engine.focus', r.followed === 3, JSON.stringify(r));
      check('the game sets sun.target: the engine yields, value stays, one warning naming the takeover and the hand-back', r.a.x === 777 && /yielded/.test(r.a.by) && r.a.warns === 1 && r.a.says.includes("{ follow: 'focus' }"), JSON.stringify(r.a));
      check("engine.shadows.box(sun, { follow: 'focus' }): follows the focus again", r.back === 9, JSON.stringify(r));
    },
  },
  {
    name: '[guard] batching says what it did',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled();
        engine.pause();
        const out = {};
        // batching: 12 copies of one game mesh opted in (userData.batch = true) in one cell -> a batch, and stats carries the note
        const T = engine.THREE, g = new T.BoxGeometry(0.3, 0.3, 0.3), m = new T.MeshStandardMaterial();
        for (let i = 0; i < 12; i++) { const x = new T.Mesh(g, m); x.position.set(500 + i * 0.5, 0, 500); x.userData.batch = true; engine.add(x); }
        engine.step(0.05); engine.step(0.05);
        out.batch = engine.batching.stats;
        return out;
      });
      check('describe().batching / batching.stats carries the note (raycast, opt out, off) while anything is batched',
        r.batch.batches > 0 && /batching\.item\(hit\.object, hit\.instanceId\)/.test(r.batch.note) && /userData\.batch = false/.test(r.batch.note), JSON.stringify(r.batch));
    },
  },
  {
    // cloud shadow and season stay as signals and shader terms: nothing about them may need the picture layer to exist
    name: '[guard] shader terms: engine.terms swaps, drops and restores cloud shadow and season on built materials; the term and patch code reach no picture entry',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const code = ['render/terms.js', 'render/patches.js', 'render/detail.js', 'render/fx/patchNodes.tsl.js'].map(read).join('\n').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      check('terms, patches and detail name no picture entry', !/\.look\b|\.style\b|\bmakeMaterial\b|\bdefineLookPart\b/.test(code));
      const r = await ev(() => {
        const { THREE, createEngine, applyEffects, materialPatches } = threedogTest;
        const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'shader-terms' });
        const m = applyEffects(new THREE.MeshLambertMaterial(), { engine: e, season: 'ground' }), has = () => materialPatches(m).join();
        const key = () => m.customProgramCacheKey(), out = { start: has() }, was = key();
        const mine = e.terms.cloudShadow({ glsl: 'reflectedLight.directDiffuse *= 0.5;' });
        out.own = key() !== was && has() === out.start;
        const later = applyEffects(new THREE.MeshLambertMaterial(), { engine: e });
        out.later = later.customProgramCacheKey().includes('game~');
        mine.remove(); const none = e.terms.cloudShadow(false);
        out.off = has();
        none.remove();
        out.back = [has().split(',').includes('clouds'), !key().includes('game~')];   // it comes back at the end of the list, so compare the term, not the key
        e.terms.season(kind => ({ glsl: `diffuseColor.rgb *= ${kind === 'ground' ? '0.5' : '0.9'};` }));
        out.season = key().includes('ground~game~');
        e.terms.season(false);
        out.seasonOff = has().split(',').includes('season');
        const keep = key();
        try { e.terms.cloudShadow(7); } catch (x) { out.bad = [x.code, x.message]; }
        out.kept = key() === keep;
        e.dispose();
        return out;
      });
      check("a game's term reaches a material already built", r.own, JSON.stringify(r));
      check('and every material made later', r.later);
      check('false takes the term off', !r.off.split(',').includes('clouds'), r.off);
      check("null gives the engine's term back", r.back[0] && r.back[1], JSON.stringify(r.back));
      check('season takes kind => spec, and false drops it', r.season && !r.seasonOff, JSON.stringify([r.season, r.seasonOff]));
      check('a wrong value throws the fix with nothing changed', r.bad?.[0] === 'engine-terms' && /glsl, tsl/.test(r.bad[1]) && r.kept, JSON.stringify(r.bad));
    },
  },
];
