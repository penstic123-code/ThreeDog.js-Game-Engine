// 第二轮 demo 的发现（雨夜送货）里归引擎的几条。守的是"不许绕开"：
//   1. look.materials.glow：夜里亮的窗户 / 招牌 / 灯泡只登记一次，正午暗、午夜亮；登记之后才建出来的模型（模板在玩家附近才建）也跟着；
//      remove() 把材质自己的 emissiveIntensity 还回去。以前游戏每 2 秒遍历整个场景按名字找材质。
const PAGE = '/tests/threads/';
export const specs = [
  {
    name: '[守] look.materials.glow: night glow is dark at noon, lit at midnight, catches a model built later, remove() restores',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'glow-night');
        E.use(T.calendar({ time: '12:00', dayLength: Infinity }));
        await E.start();
        const win = T.makeMaterial('window', { emissive: '#ffcc66', emissiveIntensity: 0.7 }, E);
        const sign = new THREE.MeshStandardMaterial({ name: 'sign', emissive: 0x33ccff, emissiveIntensity: 0.4 });   // a file model's material, by name
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), win), new THREE.Mesh(new THREE.BoxGeometry(), sign));
        const hw = E.look.materials.glow('window', { night: 2 });
        const hs = E.look.materials.glow('sign', { night: 3, day: 0.1 });
        E.step(0.1, { render: false });
        const noon = { win: win.emissiveIntensity, sign: sign.emissiveIntensity };
        E.calendar.timeOfDay = 0; E.step(0.1, { render: false });
        const midnight = { win: win.emissiveIntensity, sign: sign.emissiveIntensity };
        const later = T.makeMaterial('window', { emissive: '#ffcc66' }, E);   // a template built near the player after the rule
        const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(), later)); E.scene.add(g);
        E.step(0.1, { render: false });
        const built = later.emissiveIntensity;
        const d = E.describe().look?.materials ?? {};
        const rows = Object.keys(d).filter(k => k.startsWith('glow:'));
        hw.remove(); hw.remove(); E.step(0.1, { render: false });
        const removed = { win: win.emissiveIntensity, later: later.emissiveIntensity, sign: sign.emissiveIntensity };
        hs.remove(); E.step(0.1, { render: false });
        let bad = '';
        try { E.look.materials.glow('window', { nightt: 2 }); } catch (err) { bad = err.message; }
        const out = { noon, midnight, built, rows, found: d['glow:window.found']?.value, removed, signBack: sign.emissiveIntensity, bad };
        E.dispose();
        return out;
      });
      check('noon: window at its day value 0, sign at its day value 0.1', r.noon.win === 0 && Math.abs(r.noon.sign - 0.1) < 1e-9, JSON.stringify(r.noon));
      check('midnight: window lit at 2, sign at 3', r.midnight.win === 2 && r.midnight.sign === 3, JSON.stringify(r.midnight));
      check('a window material built after glow() (nested in a group) is lit too', r.built === 2, String(r.built));
      check('describe().look.materials lists each rule and what it found', r.rows.includes('glow:window') && r.rows.includes('glow:sign') && /2 material/.test(r.found ?? ''), JSON.stringify({ rows: r.rows, found: r.found }));
      check('remove() (twice is safe) gives each window its own emissiveIntensity back; the other rule stays', r.removed.win === 0.7 && r.removed.later === 1 && r.removed.sign === 3, JSON.stringify(r.removed));
      check('the last rule removed: the sign is back at 0.4', r.signBack === 0.4, String(r.signBack));
      check('an unknown option throws and names the options', /unknown option nightt/.test(r.bad), r.bad);
    },
  },
  {
    // 为什么：亮灯的天光阈值（0.3）以前是写死的常量，招牌想早点亮、洞里的蘑菇想全黑才亮都做不到。现在是每条规则的 dusk 选项，
    // 0.3 只是默认值。守的是：两条规则各按自己的 dusk 渐亮，默认值不变，乱填的 dusk 报错
    name: '[守] look.materials.glow: each rule fades in below its own dusk (default 0.3); a bad dusk throws',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'glow-dusk');
        E.use(T.calendar({ time: '17:00', dayLength: Infinity }));
        await E.start();
        const win = new THREE.MeshStandardMaterial({ name: 'window', emissive: 0xffcc66 });
        const sign = new THREE.MeshStandardMaterial({ name: 'sign', emissive: 0x33ccff });
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), win), new THREE.Mesh(new THREE.BoxGeometry(), sign));
        E.look.materials.glow('window', { night: 1 });
        E.look.materials.glow('sign', { night: 1, dusk: 1 });
        E.step(0.1, { render: false });
        const d = E.calendar.daylight, ss = (x, k) => { const t = Math.min(1, Math.max(0, x / k)); return 1 - t * t * (3 - 2 * t); };
        let bad = '';
        try { E.look.materials.glow('lamp', { night: 1, dusk: 0 }); } catch (err) { bad = err.message; }
        const out = { d, win: win.emissiveIntensity, sign: sign.emissiveIntensity, wantWin: ss(d, 0.3), wantSign: ss(d, 1), bad };
        E.dispose();
        return out;
      });
      check('17:00 is between day and night (daylight strictly inside 0..1)', r.d > 0 && r.d < 1, String(r.d));
      check('the default rule follows dusk 0.3, the sign its own dusk 1', Math.abs(r.win - r.wantWin) < 1e-9 && Math.abs(r.sign - r.wantSign) < 1e-9 && r.sign > r.win, JSON.stringify(r));
      check('dusk 0 throws and says what dusk is', /dusk is the daylight/.test(r.bad), r.bad);
    },
  },
  {
    // 为什么：remove() 以前丢掉整个 owner 层；两条规则写在同一个 owner 下（{ owner: 'town' }），去掉窗户那条，招牌那条也一起没了，不报错
    name: '[守] look.materials.glow: remove() takes away its own rule only, not the other rules of the same owner',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'glow-owner');
        E.use(T.calendar({ time: '00:00', dayLength: Infinity }));
        await E.start();
        const win = new THREE.MeshStandardMaterial({ name: 'window', emissive: 0xffcc66, emissiveIntensity: 0.7 });
        const sign = new THREE.MeshStandardMaterial({ name: 'sign', emissive: 0x33ccff, emissiveIntensity: 0.4 });
        E.scene.add(new THREE.Mesh(new THREE.BoxGeometry(), win), new THREE.Mesh(new THREE.BoxGeometry(), sign));
        const hw = E.look.materials.glow('window', { night: 2, owner: 'town' });
        E.look.materials.glow('sign', { night: 3, owner: 'town' });
        E.step(0.1, { render: false });
        hw.remove(); E.step(0.1, { render: false });
        const out = { win: win.emissiveIntensity, sign: sign.emissiveIntensity, rows: Object.keys(E.describe().look?.materials ?? {}).filter(k => k.startsWith('glow:') && !k.endsWith('.found')) };
        E.dispose();
        return out;
      });
      check('the window gets its own 0.7 back, the sign of the same owner stays lit at 3', r.win === 0.7 && r.sign === 3 && r.rows.join() === 'glow:sign', JSON.stringify(r));
    },
  },
];
