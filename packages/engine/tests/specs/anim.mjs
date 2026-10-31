// 真实骨骼素材（tests/anim，CC0 的 Quaternius King）：资源名 → 动作名映射、淡入淡出、玩法时钟 sync 驱动、开发期报错、describe。
// 为什么用真素材：手搓两根骨头的假人测不出 "CharacterArmature|Idle" 这种导出命名、几十根骨头的姿态是否真被 sync 摆到位。

export const specs = [
  {
    name: '骨骼动画链路：映射、过渡、sync 由玩法时间驱动、写错报错、describe',
    url: '/tests/anim/index.html',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
      const r = await ev(async () => {
        engine.pause();
        const p = engine.player, a = p.anim, model = p.root.children.find(o => o.userData.animations);
        const wrist = model.getObjectByName('WristR')   /* GLTFLoader drops the dot of Wrist.R */, v = new THREE.Vector3();
        const wristAt = () => { model.updateMatrixWorld(true); return wrist.getWorldPosition(v).clone(); };
        const { warns } = await __t.warns(() => engine.step(0.5));
        const mapped = { idle: a.state, clip: a.describe().clip, bad: warns.length };
        // 过渡：从 idle 进 attack，刚进时两边都有权重
        a.sync('attack', 0); engine.step(0.05);
        const fading = a.describe().weights;
        engine.step(0.3);
        // sync 决定进度：时间不自己走、不自己结束；角色每帧的 go() 抢不走
        a.sync('attack', 0.22); engine.step(0.5);
        const held = a.describe(), ended = held.state === 'attack' && held.driven;
        const viaDescribe = engine.describe().player?.anim;
        // 姿态真的跟着 t 变（同一 t 摆两次位置一样，不同 t 不一样）
        a.sync('attack', 0.1); engine.step(0.016); const w1 = wristAt();
        a.sync('attack', 0.25); engine.step(0.016); const w2 = wristAt();
        a.sync('attack', 0.1); engine.step(0.016); const w3 = wristAt();
        // 判定段与挥砍对齐：按玩法 t 每 0.02 秒摆一次，量右手腕高度。举到最高点应在判定段开始（0.16）附近，
        // 判定段 [0.16, 0.28) 里砍下的落差应占整个下砍的大部分（timing 写错时最高点会落在前摇中段或后摇里）
        const ys = [];
        for (let t = 0; t <= window.swing.duration + 1e-6; t += 0.02) { a.sync('attack', t); engine.step(0.001); ys.push({ t: Math.round(t * 100) / 100, y: wristAt().y }); }
        const top = ys.reduce((m, x) => x.y > m.y ? x : m, ys[0]), yAt = t => ys.find(x => Math.abs(x.t - t) < 0.011).y, low = ys[ys.length - 1].y;
        const peak = { apexT: top.t, inActive: (yAt(0.16) - yAt(0.28)) / (top.y - low) };
        // 交还控制：sync(null) 后角色的 go('idle') 照常
        a.sync(null); engine.step(0.6);
        const back = a.describe();
        // 写错：切到不存在的动作、映射到不存在的资源
        const { warns: errs } = await __t.warns(() => {
          a.sync('atack', 0.1); a.go('atack');
          const bad = engine.assets.animate(model.clone(), { states: { slash: { clip: 'Sword_Slashh' } } }); bad.dispose();
        });
        return { mapped, fading, held, ended, viaDescribe, moved: w1.distanceTo(w2), same: w1.distanceTo(w3), peak, back, errs, boneCount: model.getObjectByProperty('isSkinnedMesh', true)?.skeleton.bones.length };
      });
      check('映射：Idle_Sword 找到 "CharacterArmature|Idle_Sword"，无报错', r.mapped.idle === 'idle' && r.mapped.clip === 'Idle_Sword' && r.mapped.bad === 0, JSON.stringify(r.mapped));
      check('sync 进入时按过渡淡入（idle 与 attack 同时有权重）', r.fading.attack > 0 && r.fading.attack < 1 && r.fading.idle > 0, JSON.stringify(r.fading));
      check('sync 后进度由 t 决定（timing 把 0.22 映射到 clip 0.37 秒）：步进 0.5 秒不前进、不结束、go() 抢不走', r.ended && Math.abs(r.held.time - 0.37) < 0.01 && r.held.t === 0.22, JSON.stringify(r.held));
      check('describe().player.anim 能看到当前动作和进度', r.viaDescribe?.state === 'attack' && r.viaDescribe.driven === true && r.viaDescribe.progress > 0, JSON.stringify(r.viaDescribe));
      check('骨骼姿态跟着 t：不同 t 手腕位置不同，同一 t 位置相同', r.moved > 0.05 && r.same < 1e-4, `moved ${r.moved.toFixed(3)} same ${r.same.toExponential(1)} bones ${r.boneCount}`);
      check('挥砍对上判定段：手腕最高点在 0.16 附近，判定段内完成七成以上的下砍', r.peak.apexT >= 0.12 && r.peak.apexT <= 0.2 && r.peak.inActive > 0.7, JSON.stringify(r.peak));
      check('sync(null) 交还控制，角色回 idle', r.back.state === 'idle' && !r.back.driven, JSON.stringify(r.back));
      check('写错动作名报错并给出 `attack`', r.errs.some(m => m.includes('"atack"') && m.includes('`attack`')), JSON.stringify(r.errs));
      check('映射到不存在的资源报错，指出 states.slash 和相近名字', r.errs.some(m => m.includes('states.slash') && m.includes('Sword_Slash')), JSON.stringify(r.errs));
    },
  },
];
