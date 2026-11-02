// UI 选择光标、对话气泡通道、调用方只走约定面（页面 tests/uinav）。
// [守] 只用手柄（navigator.getGamepads 换成测试控制的手柄）就能选对话选项、在背包窗口里移动并使用物品、B 键关窗：谁把选择做成只认数字键或鼠标，这条就红。
// [守] 主对话进行时两个说话人同时冒气泡：谁把气泡又塞回主对话框排队，这条就红。
// [守] ?fakes=1 时对话 / 任务 / 相机都是 tests/contract 的假实现：NPC 对话、时间轴 say、内容加载、hud、control:'camera'、character.enter（假载具）
//      只靠约定面也能跑；谁在调用方读了约定以外的东西，这条就红。
const PAD = { A: 0, B: 1, Up: 12, Down: 13 };

async function press(ev, frames, name) {
  await ev(i => { __pad.buttons[i].pressed = true; __pad.buttons[i].value = 1; }, PAD[name]); await frames(3);
  await ev(i => { __pad.buttons[i].pressed = false; __pad.buttons[i].value = 0; }, PAD[name]); await frames(3);
}

export const specs = [
  {
    name: 'UI 光标：只用手柄选对话选项、在背包里移动并使用、B 关窗；摇杆也能移动',
    url: '/tests/uinav/index.html',
    async run({ check, ev, frames }) {
      await ev(() => {
        window.lines = [];
        engine.events.on('dialogue:line', l => lines.push(l.text));
        engine.dialogue.define('pick', { start: { text: 'Which?', choices: [{ text: 'Left', next: 'l' }, { text: 'Right', next: 'r' }] }, l: { text: 'went left' }, r: { text: 'went right' } });
        engine.dialogue.start('pick');
      });
      await frames(3);
      const sel0 = await ev(() => engine.describe().ui.dialogue?.selected);
      await press(ev, frames, 'Down');
      const sel1 = await ev(() => ({ sel: engine.describe().ui.dialogue?.selected, dom: [...document.querySelectorAll('.threedog-dlg-opts button')].findIndex(b => b.classList.contains('is-cursor')) }));
      await press(ev, frames, 'A');
      const after = await ev(() => ({ lines: lines.slice(), active: !!engine.dialogue.active }));
      check('手柄下键移动对话光标（describe 和对话框高亮一致）', sel0 === 0 && sel1.sel === 1 && sel1.dom === 1, JSON.stringify({ sel0, sel1 }));
      check('手柄 A 选中光标所在的选项（同一个 dialogue.choose op，不会再多翻一句）', after.lines.at(-1) === 'went right' && after.active, JSON.stringify(after));
      await press(ev, frames, 'A');
      check('选完后 A 继续往下（对话结束）', await ev(() => !engine.dialogue.active));

      // the inventory window: the cursor starts on content (not Close), down goes to the next row, A uses, B closes
      await ev(() => { window.used = []; engine.events.on('item:use', x => used.push(x.id ?? x.item ?? x)); engine.ui.open('inventory'); });
      await frames(3);
      const cur = () => ev(() => { const b = document.querySelector('.threedog-win-inventory .is-cursor'); return b ? { text: b.textContent, row: b.closest('.threedog-row')?.querySelector('b')?.textContent ?? null } : null; });
      const c0 = await cur();
      await press(ev, frames, 'Down');
      const c1 = await cur();
      await press(ev, frames, 'A');
      const usedIds = await ev(() => used.map(u => typeof u === 'string' ? u : JSON.stringify(u)));
      await press(ev, frames, 'Up');
      const c2 = await cur();
      check('窗口打开时光标在第一行内容上（不在"关闭"上）', c0?.row === 'Apple', JSON.stringify(c0));
      check('手柄下键移到下一行的按钮', c1?.row === 'Bread', JSON.stringify(c1));
      check('手柄 A 按下光标所在的按钮（使用了 Bread）', usedIds.some(u => u.includes('bread')), JSON.stringify(usedIds));
      check('上键回到上一行', c2?.row === 'Apple', JSON.stringify(c2));
      // the left stick moves too (half tilt counts once, not every frame)
      await ev(() => { __pad.axes[1] = 0.9; }); await frames(2); await ev(() => { __pad.axes[1] = 0; }); await frames(2);
      check('左摇杆向下也移动光标', (await cur())?.row === 'Bread');
      await press(ev, frames, 'B');
      check('手柄 B 关闭窗口（UI 焦点栈的返回键）', await ev(() => !engine.ui.isOpen('inventory')));
    },
  },
  {
    name: '对话两个通道：主对话进行时两个说话人同时冒气泡，各自排队、到时消失，不锁输入也不打断主对话',
    url: '/tests/uinav/index.html',
    async run({ check, ev, frames }) {
      const r = await ev(async () => {
        const d = engine.dialogue, a = new THREE_OBJ(), b = new THREE_OBJ();
        function THREE_OBJ() { const o = engine.player.root.clone(false); o.position.set(3, 0, -2); engine.add(o); return o; }
        b.position.set(-3, 0, -2);
        d.define('talk', { start: { text: 'Main line.' } });
        d.start('talk');
        const pa = d.say('Fresh bread!', { speaker: 'Baker', channel: 'bubble', at: a, seconds: 1 });
        d.say('Fish, cheap!', { speaker: 'Fisher', channel: 'bubble', at: b, seconds: 1 });
        d.say('Second call', { speaker: 'Baker', channel: 'bubble', at: a, seconds: 1 });   // queued behind Baker's first line
        engine.step(0.2);
        const o = { main: d.active?.speaker, bubbles: d.bubbles(), dom: [...document.querySelectorAll('.threedog-bubble')].filter(x => !x.hidden).map(x => x.textContent),
          locked: engine.input.contexts.includes('dialogue') };
        let first = false; pa.then(() => { first = true; });
        engine.step(1); await null;
        o.afterFirst = { first, bubbles: d.bubbles().map(x => x.text) };
        engine.step(1.2); await null;
        o.afterAll = { bubbles: d.bubbles().length, main: d.active?.speaker, dom: [...document.querySelectorAll('.threedog-bubble')].length };
        d.end();
        return o;
      });
      check('主对话在、两个说话人的气泡同时显示', r.main === 'talk' && r.bubbles.length === 2 && r.dom.length === 2, JSON.stringify(r));
      check('同一说话人的第二句排在后面（queued 1）', r.bubbles.find(x => x.speaker === 'Baker')?.queued === 1, JSON.stringify(r.bubbles));
      check('第一句到时结束（Promise 兑现），同一人的下一句接上', r.afterFirst.first && r.afterFirst.bubbles.includes('Second call') && !r.afterFirst.bubbles.includes('Fresh bread!'), JSON.stringify(r.afterFirst));
      check('全部到时消失，主对话一直在', r.afterAll.bubbles === 0 && r.afterAll.dom === 0 && r.afterAll.main === 'talk', JSON.stringify(r.afterAll));
    },
  },
  {
    name: '约定面：对话 / 任务 / 相机换成假实现，NPC 对话、时间轴 say、内容加载、hud、control:camera、character.enter（假载具）照常工作',
    url: '/tests/uinav/index.html?fakes=1',
    async run({ check, ev, page, frames }) {
      const r = await ev(async () => {
        const o = {};

        // content loader -> fake dialogue / quests; hud reads the fake's list() targets
        engine.content.load({
          dialogues: { guide: { speaker: 'Guide', nodes: { start: { text: 'Welcome.' } } } },
          quests: { walk: { title: 'Walk', steps: [{ text: 'Go north', target: { x: 0, z: -12 }, done: { flag: 'walked' } }] } },
        });
        engine.quests.start('walk');
        engine.step(0.3);
        o.contentDialogue = !!engine.dialogue.active === false && engine.quests.state('walk')?.active;
        o.markers = engine.describe().hud?.markers?.length ?? 0;
        // NPC talk through the fake: the interact op npc.talk starts dialogue.start(script)
        engine.npcs.add({ id: 'g', name: 'Guide', interact: { op: 'npc.talk', args: { script: 'guide' } }, position: { x: 1.2, z: 0 }, schedule: [] });
        engine.step(0.5);
        engine.ops.run('interaction.use');
        engine.step(0.1);
        o.npcTalk = engine.dialogue.log.some(l => l.name === 'guide' && l.text === 'Welcome.');
        engine.ops.run('dialogue.advance'); engine.step(0.1);
        // timeline say through the fake
        const tl = engine.timeline.play([{ say: { speaker: 'Narrator', text: 'Meanwhile...' } }]);
        engine.step(0.1);
        o.timelineSaid = engine.dialogue.log.some(l => l.text === 'Meanwhile...');
        engine.ops.run('dialogue.advance'); let ended = false; tl?.then?.(() => { ended = true; });
        for (let i = 0; i < 5 && !ended; i++) { engine.step(0.1); await new Promise(res => setTimeout(res, 20)); }
        o.timelineDone = ended || !engine.timeline.playing;
        // character.enter with a fake vehicle: the driver sits on its seat, the fake camera follows vehicle.object, exit places at exitPosition
        const box = engine.player.root.clone(false); box.position.set(5, 0, 5); engine.add(box);
        const v = fakeVehicle({ object: box });
        engine.player.enter(v); engine.step(0.2);
        o.seat = Math.abs(engine.player.root.position.x - 5) < 0.01 && engine.cameraRig.target === box && v.driver === engine.player;
        engine.player.exit(); engine.step(0.1);
        o.exit = Math.abs(engine.player.root.position.x - 6.5) < 0.6 && engine.cameraRig.target === engine.player.root && v.driver === null;
        return o;
      });
      check('内容加载把对话 / 任务交给假实现，任务开始', r.contentDialogue, JSON.stringify(r));
      check('hud 从假任务的 list() 画出目标标记', r.markers > 0, JSON.stringify(r));
      check('NPC 对话走假对话的 start', r.npcTalk, JSON.stringify(r));
      check('时间轴 say 走假对话的 say，推进后时间轴结束', r.timelineSaid && r.timelineDone, JSON.stringify(r));
      check('character.enter / exit 用假载具：坐在座位、相机跟 vehicle.object、下车到 exitPosition', r.seat && r.exit, JSON.stringify(r));
      // control: 'camera' reads only forward() / right(): the fake looks along -Z, so W walks toward -Z
      const z0 = await ev(() => engine.player.position.z);
      await page.keyboard.down('KeyW');
      await ev(z => __t.until(() => engine.player.position.z < z - 1, 8000).catch(() => {}), z0);
      await page.keyboard.up('KeyW');
      const moved = await ev(z => ({ dz: engine.player.position.z - z, dx: engine.player.position.x }), z0);
      check("control:'camera' 按假相机的 forward() 走（W 朝 -Z）", moved.dz < -1, JSON.stringify(moved));
    },
  },
];
