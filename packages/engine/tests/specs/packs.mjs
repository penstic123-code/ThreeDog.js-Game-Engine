// 资源包和内容包（packages/engine/docs/recipes/09-materials-lights-models.md）各配一条"不许绕开"的守护：
//   资源包靠 manifest 的 name / base 登记，名字解析到文件或生成函数（content 只能经 assets 找模型）；
//   内容包一次 load 多包时同一 id 两包都写就报错，模型写路径会警告、写函数会抛错。
//   字体是资源包条目（manifest fonts），界面只写名字（ui.fonts）；手写 new FontFace 绕开 assets 由规则 R21 抓（npm run check）。
export const specs = [
  {
    name: '[守] 字体走资源包：manifest fonts 按 base 解析、family 默认是名字；未登记的名字报错给写法；坏文件退回系统字体并记在 engine.loading；不点名不下载（perf 页）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { createEngine } = threedogTest, out = {};
        const make = (key, ui) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false, ...ui }, saveKey: key });
        const e = make('packs-font', {}), A = e.assets;
        A.manifest({ name: 'ui-fonts', base: '/packs/fonts/', fonts: { packsPixel: 'pixel.woff2', packsBold: { url: 'bold.woff2', family: 'packsPixel', weight: 700 } } });
        out.entries = { url: A.entries.get('packsPixel').url, type: A.entries.get('packsPixel').type, family: A.entries.get('packsBold').opts.family };
        out.preload = await A.preload();   // 没被 ui.fonts 点名、也没 preload: true：不下载
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
      check('坏字体文件：返回 null（文字退回 ui.theme.font 的下一个字体），engine.loading 里记为 failed，不加进 document.fonts', r.broken === null && r.phase === 'failed' && !r.inDoc, JSON.stringify(r));
      check('ui.fonts 写文件路径：报错，只收字体资源名', /font asset names/.test(r.path), r.path);
    },
  },
  {
    name: '[守] 资源包 name / base / builder（perf 页）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { createEngine, sky, worldArt } = threedogTest, out = {};
        const e3 = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: 'packs-test-3' });
        const A = e3.assets;
        A.manifest(worldArt);
        A.manifest({ name: 'forest', base: '/packs/forest', models: { oak: 'oak.glb', abs: '/m/abs.glb', cdn: 'https://x.test/a.glb' }, textures: { bark: { url: 'bark.png', color: true } } });
        out.assets = { pine: typeof A.builder('pine'), oak: A.builder('oak'), oakUrl: A.entries.get('oak').url, abs: A.entries.get('abs').url, cdn: A.entries.get('cdn').url,
          bark: A.entries.get('bark').url, list: A.entries.get('oak').manifest };
        // 键名写错走 readParams：开发时直接抛错（不是警告），信息带近似名
        let w = ''; try { A.manifest(/** @type {any} */ ({ modles: {} })); } catch (err) { w = err.message; }
        out.typo = /modles/.test(w) && /did you mean `models`/.test(w);
        e3.dispose();
        return out;
      });
      check('资源包：生成函数可查 builder，base 只解析相对路径，/ 开头和完整网址原样，name 标在条目上', r.assets.pine === 'function' && r.assets.oak === null && /\/packs\/forest\/oak\.glb$/.test(r.assets.oakUrl) && r.assets.abs === '/m/abs.glb' && r.assets.cdn === 'https://x.test/a.glb' && /\/packs\/forest\/bark\.png$/.test(r.assets.bark) && r.assets.list === 'forest', JSON.stringify(r.assets));
      check('manifest 写错键名开发时报错并给 did you mean', r.typo);
    },
  },
  {
    name: "[守] 水和地形的入口：水位 / 海 / 地形形状写在 water({...}) / terrain({...})，水色写进 water() 报错点名 material；palette 一处改色",
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, createEngine, worldModels, water, terrain } = threedogTest, out = {};
        const msg = f => { try { f(); return ''; } catch (e) { return e.message; } };
        const mk = key => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key });
        out.world = { level: msg(() => water({ level: 3 })), sea: msg(() => water({ sea: false })), size: msg(() => water({ size: 10 })), segments: msg(() => water({ segments: 50 })),
          terrain: msg(() => terrain({ seed: 1 })), shading: msg(() => terrain({ shading: 'flat' })) };
        const lake = mk('bound-water'); lake.use(water({ sea: false })); lake.water.material.color.set(0x123456);
        out.world.written = lake.water.material.color.getHex() === 0x123456; lake.dispose();
        const a = mk('bound-a');
        // palette: one value recolors the generated models; without it the old colors
        const has = (geo, hex) => { const c = new THREE.Color(hex), at = geo.attributes.color; for (let i = 0; i < at.count; i++) if (Math.abs(at.getX(i) - c.r) + Math.abs(at.getY(i) - c.g) + Math.abs(at.getZ(i) - c.b) < 1e-4) return true; return false; };
        const red = mk('bound-red'); red.assets.palette = { pine: 0xff0000 };
        const build = async e => { e.assets.manifest(threedogTest.worldArt); return e.assets.cached('pine', e.assets.builder('pine')); };
        return Promise.all([build(red), build(a)]).then(([gr, ga]) => {
          out.pal = { redHas: has(gr, 0xff0000), redKeepsBark: has(gr, 0x7a5536), redNoOldPine: !has(gr, 0x4c8a3b), defHas: has(ga, 0x4c8a3b), hand: has(worldModels.pine(), 0x4c8a3b) };
          a.dispose(); red.dispose();
          return out;
        });
      });
      const w = r.world;
      check('water({ level / sea / size / segments }) 和 terrain({ seed / shading }) 都是这两个模块自己的选项', w.level === '' && w.sea === '' && w.size === '' && w.segments === '' && w.terrain === '' && w.shading === '', JSON.stringify(w));
      check('写 engine.water.material.color 生效', w.written, JSON.stringify(w));
      check('engine.assets.palette 一处改色：改 pine 后松树锥体是新色，树干等没改的键保持，旧色消失；不改时和原来一样；手工调 models.pine() 用默认色', r.pal.redHas && r.pal.redKeepsBark && r.pal.redNoOldPine && r.pal.defHas && r.pal.hand, JSON.stringify(r.pal));
    },
  },
  {
    name: '[守] 内容包：多包一起 load，同一 id 两包都写报错并点名两包；按顺序后包可用前包；模型写路径警告、写函数抛错（开放世界）',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.haltLoop();
        const p = engine.player.position, out = {};
        const err = f => { try { f(); return null; } catch (e) { return e.message; } };
        out.pineBuilder = typeof engine.assets.builder('pine') === 'function';
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
      check('content 只经 assets 找模型：pine 是 world 示例资源包（art/）登记的生成函数', r.pineBuilder);
      check('按顺序加载：level 包的摆放用上 base 包的模板', r.order === null && r.placed, JSON.stringify(r));
      check('两包定义同一个 items id：报错并点名两包', /items\.packsX/.test(r.dupItem ?? '') && /pack "a"/.test(r.dupItem) && /pack "b"/.test(r.dupItem), r.dupItem);
      check('两包里同一个 props id：报错', /packs-p/.test(r.dupProp ?? ''), r.dupProp);
      check('模型写成函数：抛错，说生成函数放资源包', /asset pack/.test(r.fn ?? ''), r.fn);
      check('模型写成文件路径：警告，教登记成资源名', /file path/.test(r.path) && /packs-crate/.test(r.path), r.path);
    },
  },
];
