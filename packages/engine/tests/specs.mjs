// 自动测试的检查项。每项：打开 url，等引擎准备好，然后 run() 里用 check(说明, 是否通过, 失败时的细节) 记录结果。
//   ev(fn, 参数)  在页面里执行函数（能访问 window.engine）
//   wait(毫秒)    等一会儿（注意：测试用的是软件渲染，帧率很低，游戏时间比真实时间慢）
//   page          Playwright 的页面对象，可以按键：page.keyboard.press('KeyE')
// 第三批各组的测试在 packages/engine/tests/specs/{a,b,c,d}.mjs，拼在最后。
import { specs as specsA } from './specs/a.mjs';
import { specs as specsB } from './specs/b.mjs';
import { specs as specsC } from './specs/c.mjs';
import { specs as specsD } from './specs/d.mjs';
import { specs as specsRules } from './specs/rules.mjs';
import { specs as specsS1 } from './specs/s1.mjs';
import { specs as specsS1Ground } from './specs/s1-ground.mjs';
import { specs as specsS1Move } from './specs/s1-move.mjs';
import { specs as specsS1Saves } from './specs/s1-saves.mjs';
import { specs as specsS1World } from './specs/s1-world.mjs';
import { specs as specsS1WorldSave } from './specs/s1-world-save.mjs';
import { specs as specsS1WorldSim } from './specs/s1-world-sim.mjs';
import { specs as specsS1Entities } from './specs/s1-entities.mjs';
import { specs as specsS1Props } from './specs/s1-props.mjs';
import { specs as specsS1Npc } from './specs/s1-npc.mjs';
import { specs as specsS1Perf } from './specs/s1-perf.mjs';
import { specs as specsE } from './specs/e-usability.mjs';
import { specs as specsContainers } from './specs/containers.mjs';
import { specs as specsA2 } from './specs/a2-input-player.mjs';
import { specs as specsCameraSwitch } from './specs/camera-switch.mjs';
import { specs as specsAiTools } from './specs/ai-tools.mjs';
import { specs as specsPlayerControl } from './specs/player-control.mjs';
import { specs as specsUIParts } from './specs/ui-parts.mjs';
import { specs as specsInputContext } from './specs/input-context.mjs';
import { specs as specsThreads } from './specs/threads.mjs';
import { specs as specsPaths } from './specs/paths.mjs';
import { specs as specsS1Load } from './specs/s1-load.mjs';
import { specs as specsArt } from './specs/art.mjs';
import { specs as specsRender } from './specs/render.mjs';
import { specs as specsGenericity } from './specs/genericity.mjs';
import { specs as specsOps } from './specs/ops.mjs';
import { specs as specsArtShapes } from './specs/art-shapes.mjs';
import { specs as specsAnim } from './specs/anim.mjs';
import { specs as specsCharacterModel } from './specs/character-model.mjs';
import { specs as specsLoading } from './specs/loading.mjs';
import { specs as specsNet } from './specs/net.mjs';
import { specs as specsTerrainEdit } from './specs/terrain-edit.mjs';
import { specs as specsGrid } from './specs/grid.mjs';
import { specs as specsSkip } from './specs/skip.mjs';
import { specs as specsSession } from './specs/session.mjs';
import { specs as specsTemplates } from './specs/templates.mjs';
import { specs as specsSaveFormat } from './specs/save-format.mjs';
import { specs as specsGameplayGuards } from './specs/gameplay-guards.mjs';
import { specs as specsBatching } from './specs/batching.mjs';
import { specs as specsCoreReview } from './specs/core-review.mjs';

export const specs = [
  {
    name: '开放世界示例',
    url: '/',
    async run({ page, check, ev, frames }) {
      const info = await ev(() => ({ mods: engine.modules.size, loaded: engine.terrain.stats.loaded, player: !!engine.player }));
      check('模块全部装上', info.mods >= 20, `装了 ${info.mods} 个`);
      check('地形区块已加载', info.loaded >= 9, `${info.loaded} 个`);
      check('开场过场正在播放', await ev(() => engine.timeline.playing && !!engine.cameraOverride));
      await page.keyboard.press('Escape'); await frames(2);
      check('Esc 跳过过场且不打开设置菜单', await ev(() => !engine.timeline.playing && !engine.settings.isOpen && !engine.cameraOverride));
      await page.keyboard.press('Escape'); await frames(2);
      check('再按 Esc 打开设置菜单并锁住输入', await ev(() => engine.settings.isOpen && !engine.input.enabled));
      await page.keyboard.press('Escape'); await frames(2);
      check('再按 Esc 关闭菜单', await ev(() => !engine.settings.isOpen && engine.input.enabled));

      // 起跳：暂停实时循环后按空格，再用 step 推进 0.3 游戏秒（和帧率、真实时间无关）
      await ev(() => engine.pause());
      await page.keyboard.press('Space');
      const rise = await ev(() => { const y0 = engine.player.position.y; engine.step(0.3, { render: false }); return engine.player.position.y - y0; });
      await ev(() => engine.resume());
      check('空格起跳', rise > 0.3, rise.toFixed(2));

      await page.keyboard.press('KeyI'); await frames(2);
      check('I 打开背包', await ev(() => engine.ui.isOpen('inventory')));
      await page.keyboard.press('Escape'); await frames(2);
      check('Esc 关闭背包', await ev(() => !engine.ui.isOpen('inventory') && !engine.settings.isOpen));

      const chop = await ev(() => {
        const p = engine.player.position, t = engine.vegetation.instanceAt(p, { radius: 60, species: '松树' });
        if (!t) return 'no tree';
        engine.vegetation.removeInstance(t.species, t.cx, t.cz, t.id, { regrowSeconds: 600 });
        return engine.vegetation.isRemoved(t.species, t.cx, t.cz, t.id) && engine.saves.collect().parts?.vegetation?.removed?.[engine.vegetation.key(t.species, t.cx, t.cz, t.id)] > 0;
      });
      check('砍树：树被移除并记进植被存档', chop === true, String(chop));

      const save = await ev(() => {
        engine.inventory.add('film', 3, { silent: true }); const n = engine.inventory.count('film');
        engine.saves.save('test'); engine.inventory.remove('film', n); return engine.saves.load('test') && engine.inventory.count('film') === n;
      });
      check('存档后读档，背包数量恢复', save);

      await ev(() => { engine.weather.set('storm', 0.01); engine.i18n.setLocale('en'); });
      await frames(3);
      check('切换天气', await ev(() => engine.weather.name === 'storm' && engine.weather.current.rain > 0.5));
      check('切换成英文', await ev(() => engine.t('inventory.title') === 'Inventory' && engine.input.label('jump') === 'Space'));
      check('拍照', await ev(() => { const s = engine.ops.run('photo.take', {}, { source: 'test' }).value; return !!s && s.url.startsWith('data:image'); }));
    },
  },
  {
    name: '小城示例（关卡模块、无地形、无风格包）',
    url: '/city.html',
    async run({ check, ev }) {
      const g = await ev(() => ({ stage: engine.surface(0, -14), ramp: engine.surface(0, -7.2), street: engine.surface(10, 10), boxes: engine.collision.boxes.length }));
      check('台子高度 1.2 米', Math.abs(g.stage - 1.2) < 0.05, g.stage);
      check('坡道在台子和地面之间', g.ramp > 0.2 && g.ramp < 1.2, g.ramp);
      check('街道高度 0', Math.abs(g.street) < 0.05, g.street);
      check('楼的碰撞盒都建好了', g.boxes >= 40, g.boxes);
      await ev(() => engine.player.position.set(0, engine.surface(0, -14), -14));
      await ev(() => { engine.pause(); engine.step(1.2, { render: false }); engine.resume(); });   // 推进 1.2 游戏秒：触发区更新、箱子落地
      check('走上广场触发区', await ev(() => engine.triggers.byTag('plaza')[0]?.inside));
      check('箱子落在地面上', await ev(() => engine.rigid.bodies.every(b => b.body.translation().y > 0.3)));
    },
  },
  {
    name: '关卡模块测试页',
    url: '/tests/level/index.html',
    async run({ check, ev }) {
      const h = await ev(() => [engine.surface(0, 0), engine.surface(5, 0), engine.surface(11, 0)]);
      check('地板 0 / 斜坡 1 / 平台 2', Math.abs(h[0]) < 0.05 && Math.abs(h[1] - 1) < 0.1 && Math.abs(h[2] - 2) < 0.05, h.join(', '));
      check('标记点读出来了', await ev(() => !!engine.level.marker('spawn') && !!engine.level.marker('marker_chest')));
    },
  },
  {
    name: '实体与粒子测试页',
    url: '/tests/entities/index.html',
    async run({ check, ev, wait }) {
      const before = await ev(() => engine.particles.count());
      await ev(() => engine.particles.emit('dust', engine.player.position, { count: 50 }));
      check('粒子爆发', await ev(n => engine.particles.count() > n, before));
      const ent = await ev(() => { const e = engine.entities.spawn('sapling', { position: { x: 3, z: 3 } }); engine.step(0.2); return !!e?.object?.parent; });
      check('生成实体', ent);
      await wait(300);
    },
  },
  {
    name: '设置菜单测试页',
    url: '/tests/settings/index.html',
    async run({ page, check, ev, frames }) {
      await page.mouse.click(640, 360); await frames(2);
      await page.keyboard.press('Escape');
      check('Esc 打开设置', await ev(() => __t.until(() => engine.settings.isOpen, 5000).then(() => true, () => false)));
      await ev(() => { engine.settings.rebind('interact', 'KeyF'); engine.settings.set('vol.music', 0.25); });   // settings save to localStorage at once
      await page.keyboard.press('Escape'); await ev(() => __t.until(() => !engine.settings.isOpen, 5000).catch(() => {}));
      await page.reload(); await page.waitForFunction(() => window.engine?.stateApplied, null, { timeout: 60000 });
      check('改键在刷新后保留', await ev(() => engine.input.keysOf('interact').includes('KeyF')));
      check('音量在刷新后保留', await ev(() => Math.abs(engine.settings.get('vol.music') - 0.25) < 0.01));
      await ev(() => engine.settings.resetBindings());
    },
  },
  {
    name: '状态描述与确定性步进（开放世界）',
    url: '/',
    async run({ check, ev }) {
      const d = await ev(() => { engine.timeline.skip(); return engine.describe(); });
      const keys = ['time', 'weather', 'player', 'camera', 'nearby', 'ui', 'cutscene', 'modules', 'perf'];
      check('describe 字段齐全', keys.every(k => k in d) && d.time.clock && d.time.season && d.player.ground && d.camera.type === 'follow' && d.perf.chunks, keys.filter(k => !(k in d)).join(','));
      check('describe 可以 JSON.stringify', await ev(() => { const s = JSON.stringify(engine.describe()); return s.length > 100 && JSON.parse(s).modules.length >= 20; }));
      check('附近的东西按距离排好、最多 15 个', d.nearby.length <= 15 && d.nearby.every((x, i, a) => !i || a[i - 1].dist <= x.dist) && d.nearby.some(x => x.kind === 'pickup'), JSON.stringify(d.nearby.slice(0, 3)));
      const text = await ev(() => engine.describeText());
      check('describeText is English and at most 30 lines', !/[一-鿿]/.test(text.split('\n')[0]) && text.includes('Time:') && text.split('\n').length <= 30, text.split('\n').length + ' lines');
      const r = await ev(() => {
        engine.pause();
        const t0 = engine.elapsed, p0 = engine.player.position.clone();
        engine.input.autopilot = { x: 0, y: 1, speed: 4 };
        const d = engine.step(10);
        engine.input.autopilot = null;
        return { dt: engine.elapsed - t0, moved: engine.player.position.distanceTo(p0), paused: engine.paused, ret: !!d.time };
      });
      check('pause + step(10)：游戏时间前进约 10 秒', r.paused && r.ret && Math.abs(r.dt - 10) < 0.05, r.dt);
      check('step 期间 autopilot 让玩家移动了', r.moved > 5, r.moved);
      const s = await ev(() => { const t0 = performance.now(), c0 = engine.sky.totalDays; engine.step(600, { render: false }); return { ms: performance.now() - t0, days: engine.sky.totalDays - c0 }; });
      check('step(600) 在 30 秒内完成，天数前进', s.days > 1.5, `${Math.round(s.ms)} 毫秒（只打印，不判定），${s.days.toFixed(2)} 天`);
      // paused: the engine's onFrame does not run, so count browser animation frames (the loop's own tick) instead of milliseconds
      const still = await ev(async () => { const t = engine.elapsed; await new Promise(r => { let k = 0; const f = () => ++k >= 10 ? r() : requestAnimationFrame(f); requestAnimationFrame(f); }); return engine.elapsed === t; });
      check('暂停时实时循环不推进', still);
      check('resume 后恢复推进', await ev(async () => { engine.resume(); const t = engine.elapsed; await __t.until(() => engine.elapsed > t, 5000).catch(() => {}); return engine.elapsed > t && !engine.paused; }));
    },
  },
  {
    name: '无界面模式（?threedog-headless）',
    url: '/?threedog-headless',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const t0 = engine.elapsed; await new Promise(r => setTimeout(r, 300));
        const idle = engine.elapsed === t0;
        const d = engine.step(2);
        return { headless: engine.headless, paused: engine.paused, idle, dt: engine.elapsed - t0, ok: d.time.headless, loaded: d.perf.chunks.loaded };
      });
      check('启动后处于暂停、不自己推进', r.headless && r.paused && r.idle);
      check('step 可用，时间前进', r.ok && Math.abs(r.dt - 2) < 0.05, r.dt);
      check('地形在无界面模式下也加载了', r.loaded >= 9, r.loaded);
    },
  },
  {
    name: '状态描述（小城示例，无地形）',
    url: '/city.html',
    async run({ check, ev }) {
      const d = await ev(() => engine.describe());
      check('describe 不报错且没有地形/天气字段', !!d.player && !('weather' in d) && !d.perf.chunks && d.time.clock, Object.keys(d).join(','));
      check('附近能看到 NPC 店主', d.nearby.some(x => x.kind === 'npc' && x.name === '店主'), JSON.stringify(d.nearby));
      const text = await ev(() => { engine.pause(); engine.step(1); return engine.describeText(); });
      check('describeText 正常', text.includes('Player:') && text.split('\n').length <= 30);
      const loc = await ev(() => {
        const I18n = engine.i18n.constructor, en = new I18n(engine, { locale: 'en' }), auto = new I18n(engine, { locale: 'auto' });
        return { en: en.t('common.close'), enLocale: en.locale, zh: engine.i18n.t('common.close'), auto: auto.locale, def: engine.i18n.locale };
      });
      check("locale: 'en' gives English UI text; 'auto' follows the browser (zh-CN here)", loc.en === 'Close' && loc.enLocale === 'en' && loc.zh === '关闭' && loc.auto === 'zh-CN' && loc.def === 'zh-CN', JSON.stringify(loc));
    },
  },
  {
    name: '运行时检查：选项名、动作名写错时提示改法（只提示一次）',
    url: '/tests/cameras/index.html?cam=fixed',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { warns } = await __t.warns(() => {
          for (let i = 0; i < 2; i++) {
            // createEngine 的选项（shadows 拼错）
            const e2 = new engine.constructor({ canvas: document.createElement('canvas'), ui: { loading: false }, shadwos: false, saveKey: 'validate-test' });
            e2.renderer.dispose();
            // 模块选项：fixedCamera({ shots }) 里每个机位的参数（position 拼错）
            engine.cameraRig.add('test', { postion: [0, 5, 5], lookAt: [0, 0, 0] });
            // 按键动作名（jump 拼错）
            engine.input.pressed('jupm'); engine.input.down('jupm');
          }
        });
        const n = s => warns.filter(w => w.includes(s) && w.includes('did you mean')).length;
        return { engine: n('shadwos'), shot: n('postion'), action: n('jupm'), all: warns };
      });
      check('createEngine 选项写错：一条"你是不是想写 shadows"', r.engine === 1 && r.all.some(w => w.includes('`shadows`?')), JSON.stringify(r.all));
      check('模块选项写错：一条"你是不是想写 position"', r.shot === 1 && r.all.some(w => w.includes('`position`?')), JSON.stringify(r.all));
      check('按键动作写错：一条"你是不是想写 jump"', r.action === 1 && r.all.some(w => w.includes('`jump`?')), JSON.stringify(r.all));
      check('没有别的警告', r.all.length === 3, JSON.stringify(r.all));
    },
  },
  {
    name: '运行时检查：npcs.add 字段写错（小城示例）',
    url: '/city.html',
    async run({ check, ev }) {
      const r = await ev(async () => (await __t.warns(() => {
        for (let i = 0; i < 2; i++) engine.npcs.remove(engine.npcs.add({ name: '路人' + i, position: { x: 3, z: 3 }, scedule: [] }));
      })).warns);
      check('npcs.add 字段写错：一条"你是不是想写 schedule"', r.length === 1 && r[0].includes('scedule') && r[0].includes('did you mean `schedule`?'), JSON.stringify(r));
    },
  },
  {
    name: '接口约定：句柄、位置参数、射线并入刚体、贴图缓存键、动作重定义（小城示例）',
    url: '/city.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const out = {};
        let warns;
        try {
          ({ warns } = await __t.warns(async () => {
            // 句柄：add / on / clock 都返回 { remove() }，remove 两次无害
            const box = engine.collision.addBox([30, 0, 30], { halfWidth: 2, halfDepth: 1 });
            out.blocked = !engine.collision.walkable({ x: 30, z: 30 });
            box.remove(); box.remove();
            out.free = engine.collision.walkable({ x: 30, z: 30 });
            let n = 0; const sub = engine.events.on('conv:test', () => n++);
            engine.events.emit('conv:test'); sub.remove(); engine.events.emit('conv:test'); out.events = n;
            const t = engine.clock.after(1, () => n++); t.remove(); engine.step(2, { render: false }); out.clock = n;
            out.handles = [engine.onFrame(() => {}), engine.onFixed(() => {}), engine.raycaster.addStatic([]), engine.budget.metric('conv', () => 0)].every(h => typeof h.remove === 'function' && (h.remove(), true));
            // 位置参数：旧写法（数字）直接报错
            try { engine.collision.addBox(1, 2, 3, 4); out.oldThrows = false; } catch (e) { out.oldThrows = /must be passed as one argument/.test(e.message); }
            // 射线 targets: 'all' 打到刚体，默认 'static' 打不到
            const b = engine.rigid.bodies.reduce((m, x) => x.object.position.y > m.object.position.y ? x : m), p = b.object.position;
            const from = { x: p.x, y: p.y + 5, z: p.z }, down = [0, -1, 0];
            const all = engine.raycast(from, down, { targets: 'all' }), st = engine.raycast(from, down);
            out.rigidHit = all?.kind === 'rigid' && all.entry === b && all.object === b.object;
            out.staticMiss = !st || st.entry !== b;
            // 贴图：同一张图不同 opts 得到两份
            const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
            const [a, c, a2] = [await engine.assets.texture(url), await engine.assets.texture(url, { color: false }), await engine.assets.texture(url)];
            out.texture = a !== c && a === a2 && c.colorSpace !== a.colorSpace;
            // 动作重定义：后定义的覆盖，并提示一次
            engine.input.define('convAct', ['KeyY']); engine.input.define('convAct', ['KeyU']);
            out.redefine = engine.input.keysOf('convAct').includes('KeyU') && !engine.input.keysOf('convAct').includes('KeyY');
          }));
        } finally { engine.resume(); }
        out.warns = warns;
        return out;
      });
      check('collision.addBox(位置, 选项) 挡住；句柄 remove() 两次无害', r.blocked && r.free, JSON.stringify(r));
      check('events.on / clock.after 的句柄能取消', r.events === 1 && r.clock === 1, JSON.stringify(r));
      check('onFrame / onFixed / addStatic / metric 都返回 { remove() }', r.handles);
      check('旧的位置写法 addBox(x, z, …) 报错说明改法', r.oldThrows);
      check("engine.raycast targets: 'all' 打到刚体（kind 'rigid'、带 entry），默认不打", r.rigidHit && r.staticMiss, JSON.stringify(r));
      check('assets.texture 的 opts 算进缓存键', r.texture);
      check('input.define 重定义：后定义的覆盖并提示一次', r.redefine && r.warns.filter(w => w.includes('convAct')).length === 1, JSON.stringify(r.warns));
    },
  },
  ...['follow', 'first', 'fixed', 'rts'].map(cam => ({
    name: `相机：${cam}`,
    url: `/tests/cameras/index.html?cam=${cam}`,
    async run({ page, check, ev }) {
      const f = await ev(() => engine.cameraRig.forward());
      const p0 = await ev(() => engine.player.position.clone());
      // hold W until the player has walked a bit (by condition, not milliseconds); a timeout leaves moved null and the check fails
      await page.keyboard.down('KeyW');
      await ev(p => __t.until(() => Math.hypot(engine.player.position.x - p.x, engine.player.position.z - p.z) > 1, 10000).catch(() => {}), p0);
      await page.keyboard.up('KeyW');
      const moved = await ev(([p, f]) => { const d = engine.player.position.clone().sub(p); const l = Math.hypot(d.x, d.z); return l > 0.3 ? (d.x * f.x + d.z * f.z) / l : null; }, [p0, f]);
      check('按 W 沿相机前方移动', moved !== null && moved > 0.9, String(moved));
    },
  })),
  ...specsCameraSwitch, ...specsA, ...specsB, ...specsC, ...specsD, ...specsRules, ...specsS1, ...specsS1Ground, ...specsS1Move, ...specsS1Saves, ...specsS1World, ...specsS1WorldSave, ...specsS1WorldSim, ...specsS1Entities, ...specsS1Props, ...specsS1Npc, ...specsS1Perf, ...specsE, ...specsContainers, ...specsA2, ...specsAiTools, ...specsPlayerControl, ...specsUIParts, ...specsInputContext, ...specsThreads, ...specsArt, ...specsOps, ...specsArtShapes, ...specsLoading, ...specsNet, ...specsAnim, ...specsGrid, ...specsSkip, ...specsPaths, ...specsGenericity, ...specsTerrainEdit, ...specsS1Load, ...specsSession, ...specsCharacterModel, ...specsTemplates, ...specsSaveFormat, ...specsGameplayGuards, ...specsRender, ...specsBatching, ...specsCoreReview,
];
