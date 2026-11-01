// 三种包（packages/engine/docs/recipes/09-style-pack.md）各配一条"不许绕开"的守护：
//   风格包只放外观（lowpoly 默认导出里没有 models、没有 sky.hoursPerDay），部件列表按规矩深合并且不改原包；
//   资源包靠 manifest 的 name / base 登记，名字解析到文件或生成函数（content 只能经 assets 找模型，不再读 style.models）；
//   内容包一次 load 多包时同一 id 两包都写就报错，模型写路径会警告、写函数会抛错。
//   字体是资源包条目（manifest fonts），风格只写名字（style.ui.fonts）；手写 new FontFace 绕开 assets 由规则 R21 抓，
//   风格包里写地形生成器 / 字体文件由规则 R34 抓（npm run check）。
export const specs = [
  {
    name: '[守] 字体走资源包：manifest fonts 按 base 解析、family 默认是名字；未登记的名字报错给写法；坏文件退回系统字体并记在 engine.loading；不点名不下载（perf 页）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogTest, out = {};
        const make = (key, ui) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key, style: { ui } });
        const e = make('packs-font', {}), A = e.assets;
        A.manifest({ name: 'ui-fonts', base: '/packs/fonts/', fonts: { packsPixel: 'pixel.woff2', packsBold: { url: 'bold.woff2', family: 'packsPixel', weight: 700 } } });
        out.entries = { url: A.entries.get('packsPixel').url, type: A.entries.get('packsPixel').type, family: A.entries.get('packsBold').opts.family };
        out.preload = await A.preload();   // 没被 style.ui.fonts 点名、也没 preload: true：不下载
        out.unknown = await A.font('packsNope').then(() => '', err => err.message);
        const warn = console.warn; console.warn = () => {};
        out.broken = await A.font('packsPixel');   // 开发服务器对不存在的文件回 index.html：当成 404
        console.warn = warn;
        out.phase = e.loading.get('packsPixel', 'font')?.phase;
        out.inDoc = [...document.fonts].some(f => f.family.replace(/"/g, '') === 'packsPixel');
        out.path = (() => { try { make('packs-font-2', { fonts: ['/fonts/x.woff2'] }); return ''; } catch (err) { return err.message; } })();
        e.dispose();
        return out;
      });
      check('manifest fonts：相对路径按 base 解析，条目类型是 font，family 不写就等于名字（同族不同粗细可共用 family）', /\/packs\/fonts\/pixel\.woff2$/.test(r.entries.url) && r.entries.type === 'font' && r.entries.family === 'packsPixel', JSON.stringify(r.entries));
      check('preload 不下载没点名的字体（零成本）', r.preload.loaded === 0 && !r.preload.failed.length, JSON.stringify(r.preload));
      check('assets.font 未登记的名字：报错并给出 manifest({ fonts }) 的写法', /manifest\(\{ fonts/.test(r.unknown), r.unknown);
      check('坏字体文件：返回 null（文字退回 style.ui.font 的下一个字体），engine.loading 里记为 failed，不加进 document.fonts', r.broken === null && r.phase === 'failed' && !r.inDoc, JSON.stringify(r));
      check('style.ui.fonts 写文件路径：报错，只收字体资源名', /font asset names/.test(r.path), r.path);
    },
  },
  {
    name: '[守] 风格包只放外观、部件深合并；资源包 name / base / builder（perf 页）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine, lowpoly, lowpolyAssets } = threedogTest, out = {};
        out.visualOnly = { models: 'models' in lowpoly, hours: 'hoursPerDay' in (lowpoly.sky || {}) };
        const before = JSON.stringify(lowpoly.sky.clouds);
        const e2 = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'packs-test',
          style: [lowpoly, [{ sky: { sunSize: 600, clouds: { coverage: 0.2 } } }], null, { post: null, ui: { accent: '#123456' } }] });
        const s = e2.style;
        out.merge = { sunSize: s.sky.sunSize, keyframes: s.sky.keyframes === lowpoly.sky.keyframes, cloudColor: s.sky.clouds.color === lowpoly.sky.clouds.color,
          coverage: s.sky.clouds.coverage, post: 'post' in s, accent: s.ui.accent, fg: s.ui.fg === lowpoly.ui.fg, untouched: JSON.stringify(lowpoly.sky.clouds) === before && lowpoly.ui.accent !== '#123456' };
        const e3 = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'packs-test-3', style: lowpoly });
        out.same = e3.style === lowpoly;
        const A = e3.assets;
        A.manifest(lowpolyAssets);
        A.manifest({ name: 'forest', base: '/packs/forest', models: { oak: 'oak.glb', abs: '/m/abs.glb', cdn: 'https://x.test/a.glb' }, textures: { bark: { url: 'bark.png', color: true } } });
        out.assets = { pine: typeof A.builder('pine'), oak: A.builder('oak'), oakUrl: A.entries.get('oak').url, abs: A.entries.get('abs').url, cdn: A.entries.get('cdn').url,
          bark: A.entries.get('bark').url, list: A.entries.get('oak').manifest };
        const warn = console.warn; let w = ''; console.warn = m => { w += m; };
        A.manifest(/** @type {any} */ ({ modles: {} }));
        console.warn = warn; out.typo = /modles/.test(w) && /models/.test(w);
        e2.dispose(); e3.dispose();
        return out;
      });
      check('lowpoly 默认导出只放外观：没有 models（在资源包 assets 里）、没有 sky.hoursPerDay（玩法计时，sky() 选项）', !r.visualOnly.models && !r.visualOnly.hours, JSON.stringify(r.visualOnly));
      check('部件深合并：只改 sunSize / clouds.coverage，其余 sky 字段和数组原样；null 去掉 post；嵌套列表展平；原包不被改', r.merge.sunSize === 600 && r.merge.keyframes && r.merge.cloudColor && r.merge.coverage === 0.2 && !r.merge.post && r.merge.accent === '#123456' && r.merge.fg && r.merge.untouched, JSON.stringify(r.merge));
      check('只给一个对象：engine.style 就是它本身（不用就零成本）', r.same);
      check('资源包：生成函数可查 builder，base 只解析相对路径，/ 开头和完整网址原样，name 标在条目上', r.assets.pine === 'function' && r.assets.oak === null && /\/packs\/forest\/oak\.glb$/.test(r.assets.oakUrl) && r.assets.abs === '/m/abs.glb' && r.assets.cdn === 'https://x.test/a.glb' && /\/packs\/forest\/bark\.png$/.test(r.assets.bark) && r.assets.list === 'forest', JSON.stringify(r.assets));
      check('manifest 写错键名会提示 did you mean', r.typo);
    },
  },
  {
    name: '[守] 风格边界：风格里写水位 / 海 / 地形形状 dev 下报错并写明改到哪；材质按引擎归属（两个引擎两套风格互不拿对方的）；palette 一处改色；postAdd / postRemove 按名称改后期',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, createEngine, lowpoly, lowpolyModels, styleFrom, postAdd, postRemove } = threedogTest, out = {};
        const msg = style => { try { styleFrom(style); return ''; } catch (e) { return e.message; } };
        out.world = { level: msg({ water: { level: 3 } }), sea: msg({ water: { sea: false } }), size: msg({ water: { size: 10 } }), terrain: msg({ terrain: { config: { seed: 1 } } }),
          okShading: msg({ terrain: { config: { shading: 'flat' } }, water: { color: 1, segments: 50 } }), okPack: msg(lowpoly) };
        // two engines, two styles: nothing falls back to the first engine's pack
        const mk = (style, key) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key, style });
        const a = mk(lowpoly, 'bound-a'), b = mk([lowpoly, { materials: { character: { type: 'toon' }, pickup: { type: 'toon' }, default: { type: 'toon' } } }], 'bound-b');
        const types = rig => { const t = new Set(); rig.root.traverse(o => { if (o.isMesh) t.add(o.material.type); }); return [...t]; };
        out.iso = { a: types(a.style.character.create(a, a.style.character.colors)), b: types(b.style.character.create(b, b.style.character.colors)),
          pickupA: a.style.pickup.model({}, { color: 1, size: 1 }, a).material.type, pickupB: b.style.pickup.model({}, { color: 1, size: 1 }, b).material.type,
          methodA: a.makeMaterial('prop').type, methodB: b.makeMaterial('prop').type };
        // palette: one value recolors the generated models; without it the old colors
        const has = (geo, hex) => { const c = new THREE.Color(hex), at = geo.attributes.color; for (let i = 0; i < at.count; i++) if (Math.abs(at.getX(i) - c.r) + Math.abs(at.getY(i) - c.g) + Math.abs(at.getZ(i) - c.b) < 1e-4) return true; return false; };
        const red = mk([lowpoly, { palette: { pine: 0xff0000 } }], 'bound-red');
        const build = async e => { e.assets.manifest(threedogTest.lowpolyAssets); return e.assets.cached('pine', e.assets.builder('pine')); };
        return Promise.all([build(red), build(a)]).then(([gr, ga]) => {
          out.pal = { redHas: has(gr, 0xff0000), redKeepsBark: has(gr, 0x7a5536), redNoOldPine: !has(gr, 0x4c8a3b), defHas: has(ga, 0x4c8a3b), hand: has(lowpolyModels.pine(), 0x4c8a3b), styleKeep: red.style.palette.leaf === lowpoly.palette.leaf };
          // post helpers
          const g = { name: 'grain', create: () => ({}) }, bl = { name: 'bloom', create: () => ({}) };
          const names = parts => styleFrom(parts).post.map(p => p.name).join();
          out.post = { base: lowpoly.post.map(p => p.name).join(), appended: names([lowpoly, postAdd(g)]), swap: names([lowpoly, postAdd(bl)]), rm: names([lowpoly, postRemove('ao', 'outline')]),
            first: names([postAdd(g)]), replace: names([lowpoly, { post: [g] }]), untouched: lowpoly.post.length === 3 };
          a.dispose(); b.dispose(); red.dispose();
          return out;
        });
      });
      const w = r.world;
      check('风格里写 water.level / sea / size、terrain.config 非 shading 键：报错并点名改到 water({...}) / terrain({...})', /water\.level/.test(w.level) && /water\(\{/.test(w.level) && /water\.sea/.test(w.sea) && /water\.size/.test(w.size) && /terrain\.config\.seed/.test(w.terrain) && /terrain\(\{/.test(w.terrain), JSON.stringify(w));
      check('风格里写 terrain.config.shading、水色、水网格细分不报错；lowpoly 自己通过', w.okShading === '' && w.okPack === '', JSON.stringify(w));
      check('材质按引擎归属：第二个引擎（toon）的角色、拾取物、engine.makeMaterial 都是 toon，第一个引擎（lowpoly）的是 lambert，不串',
        r.iso.a.join() === 'MeshLambertMaterial' && r.iso.b.join() === 'MeshToonMaterial' && r.iso.pickupA === 'MeshLambertMaterial' && r.iso.pickupB === 'MeshToonMaterial' && r.iso.methodA === 'MeshLambertMaterial' && r.iso.methodB === 'MeshToonMaterial', JSON.stringify(r.iso));
      check('style.palette 一处改色：改 pine 后松树锥体是新色，树干等没改的键保持，旧色消失；不改时和原来一样；手工调 models.pine() 用默认色', r.pal.redHas && r.pal.redKeepsBark && r.pal.redNoOldPine && r.pal.defHas && r.pal.hand && r.pal.styleKeep, JSON.stringify(r.pal));
      check('post 追加、同名替换原位置；按名删；整体替换规则不变；原包不被改', r.post.appended === r.post.base + ',grain' && r.post.swap === r.post.base && r.post.rm === 'bloom' && r.post.first === 'grain' && r.post.replace === 'grain' && r.post.untouched, JSON.stringify(r.post));
    },
  },
  {
    name: '[守] 内容包：多包一起 load，同一 id 两包都写报错并点名两包；按顺序后包可用前包；模型写路径警告、写函数抛错（开放世界）',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const p = engine.player.position, out = {};
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        out.noStyleModels = engine.style.models === undefined && typeof engine.assets.builder('pine') === 'function';
        const base = { name: 'base', items: { packsGem: { name: 'gem' } }, templates: { packsBox: { model: 'rock' } } };
        const level = { name: 'level', props: [{ id: 'packs-box-1', template: 'packsBox', x: p.x + 5, z: p.z }] };
        out.order = err(() => engine.content.load([base, level]));
        out.placed = !!engine.world.get('packs-box-1');
        out.dupItem = err(() => engine.content.load([{ name: 'a', items: { packsX: {} } }, { name: 'b', items: { packsX: {} } }]));
        out.dupProp = err(() => engine.content.load([{ props: [{ id: 'packs-p', model: 'rock', x: p.x, z: p.z + 9 }] }, { props: [{ id: 'packs-p', model: 'pine', x: p.x, z: p.z + 9 }] }]));
        out.fn = err(() => engine.content.load({ props: [{ id: 'packs-fn', model: () => null, x: p.x, z: p.z }] }));
        const warn = console.warn; let w = ''; console.warn = m => { w += m; };
        err(() => engine.content.load({ props: [{ id: 'packs-path', model: '/models/packs-crate.glb', x: p.x + 40, z: p.z + 40 }] }));
        engine.world.remove('packs-path');   // 只看警告，不真去下载这个不存在的文件
        console.warn = warn; out.path = w;
        return out;
      });
      check('content 只经 assets 找模型：style 里没有 models，pine 是 lowpoly 资源包登记的生成函数', r.noStyleModels);
      check('按顺序加载：level 包的摆放用上 base 包的模板', r.order === null && r.placed, JSON.stringify(r));
      check('两包定义同一个 items id：报错并点名两包', /items\.packsX/.test(r.dupItem ?? '') && /pack "a"/.test(r.dupItem) && /pack "b"/.test(r.dupItem), r.dupItem);
      check('两包里同一个 props id：报错', /packs-p/.test(r.dupProp ?? ''), r.dupProp);
      check('模型写成函数：抛错，说生成函数放资源包', /asset pack/.test(r.fn ?? ''), r.fn);
      check('模型写成文件路径：警告，教登记成资源名', /file path/.test(r.path) && /packs-crate/.test(r.path), r.path);
    },
  },
];
