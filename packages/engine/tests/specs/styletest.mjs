// Style test page (examples/styletest, /styletest.html): the fixed scene a style is judged by.
// Guard: the page boots with every exhibit, each named view moves the camera and shows up in describe(), URL words (time=dusk, weather=雨) work,
// the page renders a frame under each parameter combination (the runner fails a spec on any console error), and `shot styletest --view` reaches the page.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const READY = { timeout: 60000 };
const open = async (page, q = '') => { await page.goto(new URL('/styletest.html' + q, page.url()).href); await page.waitForFunction(() => window.engine?.stateApplied && engine.world.ready, null, READY); };
const VIEWS = ['overview', 'character', 'water', 'room', 'path', 'ui'];

export const specs = [
  {
    name: '风格测试页：展品齐全，每个命名机位切换后 describe 正确、镜头真的动了',
    url: '/styletest.html',
    async run({ page, check, ev, frames }) {
      await page.waitForFunction(() => engine.world.ready, null, READY);
      const s0 = await ev(() => ({ d: engine.describe().styletest, water: engine.waterLevel, player: !!engine.player,
        ids: ['pine', 'round-tree', 'rock', 'wood', 'stone', 'metal', 'glass', 'shadow-stage', 'room', 'guide'].filter(id => !engine.world.get(id)) }));
      check('默认机位是总览，风格 lowpoly，环境照明关', s0.d?.view === 'overview' && s0.d.style === 'lowpoly' && s0.d.env === false, JSON.stringify(s0.d));
      check('展品都登记了（树、石头、木/石/金属、玻璃、阴影接收面、房间、角色），有水面和玩家', s0.ids.length === 0 && s0.water > -1e6 && s0.player, JSON.stringify(s0));

      const seen = {};
      for (const name of VIEWS) {
        const ok = await ev(n => engine.ops.run('styletest.view', { name: n }).ok, name);
        await frames(2);
        const r = await ev(() => { const p = engine.camera.position; return { view: engine.describe().styletest.view, pos: [p.x, p.y, p.z].map(v => +v.toFixed(1)) }; });
        seen[name] = r.pos.join(',');
        check(`机位 ${name}：op 成功，describe 里的 view 是 ${name}`, ok && r.view === name, JSON.stringify(r));
      }
      check('六个机位里镜头位置互不相同（总览和界面共用一个镜头除外）', new Set(Object.values(seen)).size >= 5, JSON.stringify(seen));
      const bad = await ev(() => engine.ops.run('styletest.view', { name: 'nowhere' }));
      check('机位名写错：op 不执行并说明可用名字', !bad.ok && bad.code === 'unknownView', JSON.stringify(bad));

      // path: constant speed along a fixed line, so the distance between two readings is speed x elapsed time (the line is 24 m, so 2 s never reaches the turn)
      await ev(() => engine.ops.run('styletest.view', { name: 'path' }));
      await frames(2);
      const a = await ev(() => [engine.camera.position.x, engine.elapsed]);
      await ev(() => engine.step(2, { render: false }));
      const b = await ev(() => [engine.camera.position.x, engine.elapsed]);
      check('移动镜头路径：走过的距离 = 2.5 米/秒 x 经过的时间，匀速', Math.abs(Math.abs(b[0] - a[0]) - 2.5 * (b[1] - a[1])) < 0.4 && b[1] - a[1] > 1.9, JSON.stringify([a, b]));

      // ui: dialogue line and bag open; leaving closes them
      await ev(() => engine.ops.run('styletest.view', { name: 'ui' }));
      await frames(3);
      const ui = await ev(() => ({ bag: engine.ui.get('inventory')?.open ?? !!document.querySelector('.threedog-win'), say: !!engine.dialogue.active }));
      check('界面机位：对话框和背包都出现了', ui.say && ui.bag, JSON.stringify(ui));
      await ev(() => engine.ops.run('styletest.view', { name: 'overview' }));
      await frames(2);
      check('离开界面机位后对话框关闭', await ev(() => !engine.dialogue.active));
    },
  },
  {
    name: '风格测试页：URL 参数（time=dusk、weather=雨、view=室内、env=1、style=none）生效，渲染一帧无错',
    url: '/styletest.html',
    async run({ page, check, ev, frames }) {
      await open(page, '?time=dusk&weather=%E9%9B%A8&view=%E5%AE%A4%E5%86%85&env=1');
      await frames(3);
      let r = await ev(() => { engine.step(1 / 30, { render: true }); return { view: engine.describe().styletest.view, env: engine.sky.environment?.source, t: engine.calendar.timeOfDay, w: engine.weather.name }; });
      check('黄昏 18:30、中文天气词「雨」、中文机位名「室内」、环境照明开', Math.abs(r.t - 18.5 / 24) < 0.01 && r.view === 'room' && r.env === 'sky' && r.w === 'rain', JSON.stringify(r));
      await open(page, '?style=none&time=night&weather=snow&view=water');
      await frames(3);
      r = await ev(() => { engine.step(1 / 30, { render: true }); return { d: engine.describe().styletest, t: engine.calendar.timeOfDay }; });
      check('style=none：不带风格包也能渲染，仍是水面机位、夜里', r.d.style === 'none' && r.d.view === 'water' && r.t > 0.9, JSON.stringify(r));
      const warns = [];
      page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
      await open(page, '?view=nowhere');
      check('机位名写错：回到总览并在控制台提示', (await ev(() => engine.describe().styletest.view)) === 'overview' && warns.some(w => w.includes("unknown view 'nowhere'")), warns.join(' | '));
    },
  },
  {
    name: '风格工作台（?panel=1）：实时项立刻生效，需重建项不假装实时，导出可粘贴，原风格包不被改写',
    url: '/styletest.html',
    async run({ page, check, ev, frames }) {
      await page.goto(new URL('/styletest.html?panel=1', page.url()).href);
      await page.waitForFunction(() => window.engine?.stateApplied && window.engine.styleWorkbench, null, READY);
      // tweakpane bindings by label; setRawValue fires the same 'change' event a drag does
      const setBinding = (label, value) => ev(([l, v]) => {
        const all = n => (n.children ?? []).flatMap(c => [c, ...all(c)]);
        const b = all(engine.styleWorkbench.pane).find(c => c.label === l);
        if (!b) return false;
        const text = typeof v === 'string' && b.element.querySelector('input[type=text]');   // a color is typed into its text field, like a person would
        if (text) { text.value = v; text.dispatchEvent(new Event('change', { bubbles: true })); } else b.controller.value.setRawValue(v);
        return true;
      }, [label, value]);
      const before = await ev(() => ({ exp: engine.renderer.toneMappingExposure, styleExp: engine.style.exposure, pine: engine.style.palette.pine, post: engine.post.list().map(p => p.name) }));
      check('面板打开，列出了后期效果', before.post.length > 0 && !!(await ev(() => document.querySelector('.tp-rotv'))), JSON.stringify(before.post));

      check('找到并改了曝光（实时）', await setBinding('曝光 exposure', 1.7));
      const live = await ev(() => ({ exp: engine.renderer.toneMappingExposure, styleExp: engine.style.exposure }));
      check('曝光立刻变了，engine.style.exposure 没被改写', live.exp === 1.7 && live.styleExp === before.styleExp, JSON.stringify(live));

      check('找到并改了模型色 pine（需重建）', await setBinding('pine', '#112233'));
      const after = await ev(() => ({ pine: engine.style.palette.pine, text: engine.styleWorkbench.export(), changes: engine.describe().stylePanel.changes }));
      check('需重建项不改运行中的画面：engine.style.palette.pine 原值不变', after.pine === before.pine, `${after.pine}`);
      check('导出是可粘贴的对象字面量：exposure: 1.7 和 palette: { pine: 0x112233 }', /exposure: 1\.7,/.test(after.text) && /palette: \{\n\s+pine: 0x112233,/.test(after.text), after.text);

      // apply and rebuild: the page reloads with ?ov= and the rebuilt engine really has the new color; the pack file itself was never written
      await Promise.all([page.waitForNavigation(READY), page.getByText('应用并重建预览').first().click()]);
      await page.waitForFunction(() => window.engine?.stateApplied && window.engine.styleWorkbench, null, READY);
      const rebuilt = await ev(() => ({ url: location.search, pine: engine.style.palette.pine, exp: engine.renderer.toneMappingExposure, changes: engine.describe().stylePanel.changes }));
      check('重建后 ?ov= 带着覆盖，调色板 pine 变成 0x112233，曝光覆盖也带上', /ov=/.test(rebuilt.url) && rebuilt.pine === 0x112233 && rebuilt.exp === 1.7, JSON.stringify(rebuilt));
      check('重建后面板接着上次的覆盖继续累加', rebuilt.changes.palette?.pine === 0x112233, JSON.stringify(rebuilt.changes));
    },
  },
  {
    name: '风格工作台：tweakpane 缺失或加载失败时页面给出提示，不白屏',
    url: '/styletest.html',
    async run({ page, check, ev }) {
      await page.route(/tweakpane/, route => route.abort());
      await page.goto(new URL('/styletest.html?panel=1', page.url()).href);
      await page.waitForFunction(() => window.engine?.stateApplied && engine.world.ready, null, READY);
      await page.waitForFunction(() => !document.getElementById('panel-note').hidden, null, READY);
      const r = await ev(() => ({ note: document.getElementById('panel-note').textContent, bench: !!engine.styleWorkbench, view: engine.describe().styletest.view }));
      check('页面里有明确提示（点名 tweakpane 和 npm install），页面本身照常运行，没有工作台', /tweakpane/.test(r.note) && /npm install/.test(r.note) && !r.bench && r.view === 'overview', JSON.stringify(r));
    },
    expectErrors: /tweakpane|Failed to load resource|net::ERR_FAILED/i,
  },
  {
    name: '[守] threedog shot styletest --view：页面名简写、view 并入文件名、describe 里是对应机位',
    url: '/styletest.html',
    async run({ check, page }) {
      const root = fileURLToPath(new URL('../../../..', import.meta.url));
      const r = spawnSync(process.execPath, ['packages/tools/bin/threedog.mjs', 'shot', 'styletest', '--view', 'room', '--time', 'dusk', '--weather', 'rain'], { cwd: root, encoding: 'utf8', timeout: 240000 });
      const out = r.stdout + r.stderr;
      // shot prints only the picture state (pageFns PICTURE), so the view is read from the page shot opens: the same query on this page
      check('shot 成功，输出有机位行', r.status === 0 && /Camera: /.test(out), out.slice(-400));
      await open(page, '?view=room');
      const view = await page.evaluate(() => engine.describe().styletest.view);
      check('view=room 时 describe 里 styletest 的机位是 room', view === 'room', view);
      const dir = fileURLToPath(new URL('../../.threedog/shots', import.meta.url));
      const file = existsSync(dir) && readdirSync(dir).find(f => f === 'styletest_tdusk_rain_view-room_w1.png');
      check('截图文件名带 view：styletest_tdusk_rain_view-room_w1.png', !!file, existsSync(dir) ? readdirSync(dir).join(', ') : 'no shots dir');
    },
  },
];
