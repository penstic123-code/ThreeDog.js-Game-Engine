// 第二轮 demo 的发现（雨夜送货）里归引擎的几条。守的是"不许绕开"：
//   1. uNight：夜里亮的窗户 / 招牌 / 灯泡读这个信号，和灯池的 dusk 同一条曲线。
const PAGE = '/tests/threads/';
export const specs = [
  {
    // the glow verb is gone; what the engine still owes a game's lit windows is the curve itself, as a signal, with or without a sky
    name: '[guard] uNight: 0 at noon, 1 at midnight, the fade is lightPool dusk 0.3 on the calendar; with no calendar and no sky it stays 0; a material that reads it glows as the lamps do',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, THREE } = threedogThreads, T = threedogThreads.all;
        const E = mk(T.createEngine, 'night-signal');
        E.use(T.calendar({ time: '12:00', dayLength: Infinity }));
        await E.start();
        const win = new THREE.MeshStandardMaterial({ emissive: '#ffcc66' });
        E.onFrame(() => { win.emissiveIntensity = 2 * E.uniforms.uNight.value; });
        const at = t => { E.calendar.timeOfDay = t; E.step(0.1, { render: false }); return { night: E.uniforms.uNight.value, day: E.uniforms.uDaylight.value, cal: E.calendar.daylight, tod: E.uniforms.uTimeOfDay.value, win: win.emissiveIntensity }; };
        const noon = at(0.5), midnight = at(0), dusk = at(0.27);
        E.dispose();
        const N = mk(T.createEngine, 'night-signal-none');
        await N.start(); N.step(0.1, { render: false });
        const none = N.uniforms.uNight.value;
        N.dispose();
        return { noon, midnight, dusk, none };
      });
      check('noon 0, midnight 1, written every frame; a material fed from it follows', r.noon.night === 0 && r.noon.win === 0 && r.midnight.night === 1 && r.midnight.win === 2, JSON.stringify(r));
      const t = r.dusk.cal / 0.3, want = 1 - t * t * (3 - 2 * t);
      check('the fade is the smoothstep below daylight 0.3', r.dusk.cal > 0 && r.dusk.cal < 0.3 && Math.abs(r.dusk.night - want) < 1e-9, JSON.stringify(r.dusk));
      check('uDaylight tells the calendar time with no sky', Math.abs(r.dusk.day - r.dusk.cal) < 1e-9 && r.noon.day === 1, JSON.stringify(r.dusk));
      check('uTimeOfDay follows the calendar with no sky (it used to freeze at 0.5)', r.noon.tod === 0.5 && r.midnight.tod === 0 && Math.abs(r.dusk.tod - 0.27) < 1e-9, JSON.stringify([r.noon.tod, r.midnight.tod, r.dusk.tod]));
      check('nothing tells day from night: uNight stays 0', r.none === 0, String(r.none));
    },
  },
];
