// 资源加载可观察（engine.loading）：缺文件时指出是哪个、关键项阻塞开局并说清、可降级项用兜底继续；
// 全部执行完但有失败时结果显示失败；加载中 describe 能说出在等哪一项；加载界面件拿到同一份"当前项"。页面 tests/loading。
// [守] 不许绕开：引擎和游戏里所有模型 / 贴图的下载解码只能走 core/assetLoad.js（经 assets._fetch 记成任务），
//      谁直接 new GLTFLoader / TextureLoader 或调 loadAsync / parseAsync，加载视图就看不到它：这条静态检查在规则 R21（npm run check）。
export const specs = [
  {
    name: '加载可观察：缺文件的可降级项用兜底继续，结果显示失败并指出文件、HTTP 状态和清单；缺引用的模型记下缺哪个文件',
    url: '/tests/loading/index.html',
    expectErrors: /404|Not Found|Couldn't load texture|Failed to load resource/,   // 故意缺的文件：浏览器和 GLTFLoader 自己会报
    async run({ check, ev }) {
      const r = await ev(async () => {
        const E = threedogLoad.make('soft', { ui: { loading: false } });
        const url = location.origin + '/textures/missing-ref.png';
        E.assets.manifest({ name: 'level-1',
          models: { tri: threedogLoad.gltfUrl(), bush: '/models/missing-bush.glb', refs: threedogLoad.gltfUrl(url), shrub: { url: '/models/missing-shrub.glb', fallback: 'tri' } },
          textures: { grass: '/textures/missing-grass.png' },
        });
        const pre = await E.assets.preload(null);
        await E.start();
        const v = E.loading.view(), bush = await E.assets.model('bush'), shrub = await E.assets.model('shrub');
        return {
          ready: E.ready, pre, v, tri: E.loading.get('tri'), text: E.describeText(),
          bushName: bush.name, shrubTri: !!shrub.getObjectByName('tri'), refsMissing: E.loading.get('refs').missing,
        };
      });
      const f = Object.fromEntries(r.v.failed.map(x => [x.name, x]));
      check('可降级项失败不阻塞开局', r.ready && !r.v.blocked, JSON.stringify(r.v).slice(0, 300));
      check('全部执行完但有失败：done 为真、ok 为假，preload 结果也列出失败', r.v.done && !r.v.ok && r.pre.ok === false && r.pre.failed.includes('bush') && r.pre.failed.includes('grass'), JSON.stringify(r.pre));
      check('失败项指出文件、HTTP 404、来源清单', f.bush?.error.url === '/models/missing-bush.glb' && f.bush.error.status === 404 && f.bush.source.manifest === 'level-1' && f.grass?.error.status === 404, JSON.stringify(f.bush));
      check('兜底：默认灰色占位、指定 fallback 用那一项', f.bush?.fallback === 'gray placeholder' && r.bushName === 'placeholder' && f.shrub?.fallback === 'tri' && r.shrubTri, `${r.bushName} ${f.shrub?.fallback}`);
      check('缺引用的模型照常加载但记下缺的文件，并进 warnings', r.refsMissing?.[0]?.endsWith('/textures/missing-ref.png') && r.v.warnings.some(w => w.name === 'refs'), JSON.stringify(r.refsMissing));
      check('成功项记录来源（清单、路径、动画名）', r.tri.phase === 'done' && r.tri.source.manifest === 'level-1' && Array.isArray(r.tri.source.animations), JSON.stringify(r.tri.source).slice(0, 200));
      check('describeText 有一行写出失败项', /Load failed: .*bush.*404/.test(r.text), r.text.split('\n').find(l => l.startsWith('Load')) ?? '');
    },
  },
  {
    name: '加载可观察：关键项缺文件时阻塞开局并报清楚（start 拒绝、加载界面件收到失败项、describe 标 blocked）',
    url: '/tests/loading/index.html',
    expectErrors: /404|Not Found|Failed to load resource|Startup blocked/,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const log = [];
        const part = () => ({ show() {}, update: d => log.push({ text: d.text, failed: d.failed?.map(x => x.name) }), hide: () => log.push('hide'), dispose() {} });
        const E = threedogLoad.make('hard', { ui: { loading: part } });
        E.assets.manifest({ name: 'main', models: { hero: { url: '/models/missing-hero.glb', critical: true }, tri: threedogLoad.gltfUrl() } });
        const msg = await E.start().then(() => 'started', e => e.message);
        return { msg, ready: E.ready, v: E.loading.view(), d: E.describe().loading, text: E.describeText(), log };
      });
      check('start() 拒绝，信息写明是哪个文件、404、哪份清单', /Startup blocked/.test(r.msg) && r.msg.includes('/models/missing-hero.glb') && /404/.test(r.msg) && /manifest "main"/.test(r.msg), r.msg.split('\n').join(' '));
      check('引擎没进入 ready，视图 blocked', !r.ready && r.v.blocked && r.v.failed[0]?.critical && r.d.blocked, JSON.stringify(r.v.failed[0]).slice(0, 200));
      const last = r.log.at(-1);
      check('加载界面件停在失败上（收到 failed 且没隐藏）', last?.failed?.includes('hero') && /hero/.test(last.text) && !r.log.includes('hide'), JSON.stringify(last));
      check('describeText 写明开局被阻塞', /Load failed \(start blocked\)/.test(r.text), r.text.split('\n').find(l => l.startsWith('Load')) ?? '');
    },
  },
  {
    name: '加载可观察：加载中 describe 能说出在等哪一项（游戏自己的步骤 → 模块），界面件文字是同一项',
    url: '/tests/loading/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const texts = [];
        const part = () => ({ show() {}, update: d => texts.push(d.text), hide() {}, dispose() {} });
        const E = threedogLoad.make('wait', { ui: { loading: part } });
        let ready = false, finish;
        E.use({ name: 'slowThing', isReady: () => ready });
        const step = E.loading.track('level-data', () => new Promise(res => { finish = res; }));
        const started = E.start();
        const until = async f => { for (let i = 0; i < 200 && !f(); i++) await new Promise(res => setTimeout(res, 20)); };
        await until(() => E.loading.view().pending.some(p => p.name === 'level-data'));
        await until(() => texts.some(t => /level-data/.test(t)));   // start() first reads the save index, then drives the part
        const a = { w: E.describe().loading.waiting, text: E.describeText().split('\n').find(l => l.startsWith('Loading:')) };
        finish({ ok: 1 }); await step;
        await until(() => /slowThing/.test(E.loading.view().waiting ?? ''));
        const b = E.describe().loading.waiting;
        const shown = texts.slice();
        ready = true; await started;
        return { a, b, shown, after: E.loading.view(), step: E.loading.get('level-data', 'step') };
      });
      check('在等游戏自己的步骤时点名它', /building step "level-data"/.test(r.a.w) && /^Loading: building step "level-data"/.test(r.a.text ?? ''), JSON.stringify(r.a));
      check('步骤完成后点名还没就绪的模块', /waiting for module slowThing/.test(r.b ?? ''), r.b);
      check('加载界面件显示当前在等的那一项', r.shown.some(t => /level-data/.test(t)), JSON.stringify(r.shown).slice(0, 300));
      check('就绪后 done 且 ok，步骤记为完成', r.after.done && r.after.ok && r.step.phase === 'done', JSON.stringify(r.after.counts));
    },
  },
];
