// 环境照明（look.env）：默认关、开 / 关、'sky' 来源按间隔重生成而不是每帧、关闭与 dispose 时释放 GPU 资源。
// 画面只验证"能渲染一帧"；harness 会把 console 错误记为失败。

export const specs = [
  {
    name: '[守] 环境照明：默认关闭；look.env 设 scene.environment / 强度 / 旋转且不动背景；null 关闭并释放',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const s = engine.sky, sc = engine.scene, out = {};
        out.defaultOff = sc.environment === null && s.environment === null;
        const bg = sc.background;
        engine.look.env.replace('sky'); engine.look.env.set({ intensity: 0.5, rotation: 1 });
        out.on = !!sc.environment && sc.environmentIntensity === 0.5 && Math.abs(sc.environmentRotation.y - 1) < 1e-9;
        out.bgSame = sc.background === bg;
        engine.look.env.set({ intensity: 0.8 });        // 只改给出的字段
        out.info = s.environment;
        out.partial = s.environment.source === 'sky' && sc.environmentIntensity === 0.8 && s.environment.builds === 1;
        const target = s._env.target; let freed = false; target.addEventListener('dispose', () => { freed = true; });
        engine.step(1 / 30, { render: true });       // 开着环境照明渲染一帧
        engine.look.env.replace(false);
        out.off = sc.environment === null && s.environment === null;
        out.freed = freed;
        try { engine.look.env.set({ intensity: 1 }); out.noSource = ''; } catch (e) { out.noSource = e.message; }
        return out;
      });
      check('默认不设环境（scene.environment 与 sky.environment 都是 null）', r.defaultOff);
      check('look.env 设上贴图、强度、旋转，背景不变', r.on && r.bgSame, JSON.stringify(r));
      check('只给部分字段时其余保持，且不重复生成', r.partial, JSON.stringify(r.info));
      check('null 关闭：scene.environment 清空且 PMREM 目标已释放', r.off && r.freed, JSON.stringify(r));
      check('没有 source 时只设强度：不报错，环境保持关闭', r.noSource === '' && r.off, r.noSource);
    },
  },
  {
    name: '[守] 环境照明：\'sky\' 来源按间隔重生成（天空没变不生成，变了也要等够间隔），dispose 释放',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const s = engine.sky, out = {};
        s.dayLength = Infinity;                       // 时间不自己走，只由测试改
        engine.weather.setAuto(false); engine.weather.set('clear', 0.01);   // 云量跟天气走，先定住
        engine.step(1, { render: false });
        engine.look.env.replace('sky'); engine.look.env.set({ interval: 1 });
        engine.step(0.05, { render: false });         // 第一帧按当时的天空颜色生成
        const b0 = s.environment.builds;
        engine.step(0.2, { render: false }); engine.step(0.2, { render: false });
        out.idle = s.environment.builds - b0;         // 天空没变：不生成
        s.timeOfDay = (s.timeOfDay + 0.2) % 1;
        engine.step(0.2, { render: false });
        out.early = s.environment.builds - b0;        // 变了，但没到间隔
        engine.step(1.2, { render: false });
        out.late = s.environment.builds - b0;         // 够间隔：生成一次
        engine.step(1.2, { render: false }); engine.step(1.2, { render: false });
        out.after = s.environment.builds - b0;        // 又没变：不再生成
        const target = s._env.target; let freed = false; target.addEventListener('dispose', () => { freed = true; });
        engine.dispose();
        out.disposed = freed && engine.scene.environment === null;
        return out;
      });
      check('天空没变时不重新生成', r.idle === 0, JSON.stringify(r));
      check('天空变了但没到间隔时不生成', r.early === 0, JSON.stringify(r));
      check('够间隔后生成一次，之后天空不变就不再生成', r.late === 1 && r.after === 1, JSON.stringify(r));
      check('engine.dispose 释放环境贴图并清掉 scene.environment', r.disposed, JSON.stringify(r));
    },
  },
  {
    name: '[守] 环境照明：低档设备的默认值（environmentFor）与风格 / 游戏覆盖',
    url: '/',
    async run({ check }) {
      const { environmentFor } = await import('../../modules/sky/environment.js');   // 纯函数，直接在测试进程里调
      const style = { source: 'sky', intensity: 0.6 };
      const r = {
        high: environmentFor('high', style, undefined),
        low: environmentFor('low', style, undefined),
        lowOff: environmentFor('low', { ...style, low: false }, undefined),
        over: environmentFor('high', style, { intensity: 2 }),
        none: environmentFor('high', undefined, undefined),
      };
      check('高档按原样；低档重生成间隔变 4 倍；low:false 低档关闭；游戏覆盖风格；没有 source 即关闭',
        r.high.intensity === 0.6 && r.low.interval === 4 && r.lowOff === null && r.over.intensity === 2 && r.over.source === 'sky' && r.none === null, JSON.stringify(r));
    },
  },
];
