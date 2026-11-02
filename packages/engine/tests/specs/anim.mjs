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
  {
    // 代码现场生成最小骨骼 glb（tests/anim/rig.js，不下载素材），走真实导入；映射写在资源清单里（数据），游戏代码只说动作名。
    // 守卫（不许绕开）：sync 驱动时姿态只由玩法 t 决定——大步长推进帧时间，片段时间不动、不发 anim:end；
    // 有人改成"sync 只设起点、之后让 mixer 自己走"，或让 go() 抢回控制，这条会红。
    name: '骨骼动画最小链路：生成的 glb、清单里的动作映射、check 报缺、sync 跟玩法时钟',
    url: '/tests/anim/index.html',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
      const r = await ev(async () => {
        engine.pause();
        const url = URL.createObjectURL(new Blob([await window.skinnedGlb()], { type: 'model/gltf-binary' }));
        const states = { idle: { clip: 'Idle_Armed' }, walk: { clip: 'Walk' }, attack: { clip: 'Slash', loop: false, timing: 0.5 }, hurt: { clip: 'Hit', loop: false } };
        engine.assets.manifest({ name: 'generated', models: {
          dummy: { url, animation: { fade: 0.2, states } },
          dummyBad: { url, animation: { states: { idle: { clip: 'Idle' }, attack: { clip: 'Slsh', loop: false } } } },
          // 键名写错（loops）走 readParams：开发时 animate() 抛错，不是警告；片段名写错（Slsh）才是提示（片段可能晚到）
          dummyTypo: { url, animation: { states: { attack: { clip: 'Slash', loops: false } } } },
        } });
        const m = await engine.assets.model('dummy'); engine.add(m);
        const loaded = { clips: engine.loading.get('dummy')?.source.animations, bones: m.getObjectByProperty('isSkinnedMesh', true)?.skeleton.bones.length };
        const a = engine.assets.animate(m), hand = m.getObjectByName('Hand'), v = new THREE.Vector3();
        const handY = () => { m.updateMatrixWorld(true); return hand.getWorldPosition(v).y; };
        const mapped = { attack: a.states.attack?.clip, fade: a.fade, ok: a.check(['idle', 'walk', 'attack', 'hurt']) };
        // 过渡：idle → walk 中途两边都有权重，过完只剩 walk
        a.go('idle'); engine.step(0.3); a.go('walk'); engine.step(0.1);
        const mid = a.describe().weights; engine.step(0.3); const after = a.describe();
        // sync：timing 0.5 = 1 秒的 Slash 摊到玩法 0.5 秒；t=0.15 → 片段 0.3 秒（手举到最高）
        const ends = []; const off = engine.events.on('anim:end', e => ends.push(e.state));
        a.sync('attack', 0.15); engine.step(0.25); const top = handY();
        engine.step(2); a.go('idle'); engine.step(0.016);
        const held = a.describe(), topAgain = handY();
        a.sync('attack', 0.3); engine.step(0.016); const down = handY();
        off.remove(); a.sync(null); a.go('idle'); engine.step(0.4);
        const back = { state: a.describe().state };
        // 映射缺动作 / 资源名写错 / 键名写错：都指向清单里那一条
        const missing = a.check(['idle', 'attack', 'die']);
        const bad = await __t.warns(async () => { const mb = await engine.assets.model('dummyBad'); engine.assets.animate(mb).dispose(); });
        let typo = ''; const mt = await engine.assets.model('dummyTypo');
        try { engine.assets.animate(mt).dispose(); } catch (e) { typo = e.message; }
        // 角色按名字用这个模型：默认的 Idle 不能盖掉清单映射的 Idle_Armed
        const c = new window.Character(engine, { model: 'dummy' }); await c.whenReady;
        const ch = { idle: c.anim?.states.idle.clip, fade: c.anim?.fade };
        c.dispose(); engine.remove(m);
        return { loaded, mapped, mid, after, top, topAgain, down, held, ends, back, missing, bad: bad.warns, typo, ch };
      });
      check('生成的 glb 走真实导入：片段名保持 Blender 式 "Armature|Slash"，骨骼 3 根', r.loaded.clips?.includes('Armature|Slash') && r.loaded.bones === 3, JSON.stringify(r.loaded));
      check('清单里的映射生效（attack → Slash，fade 0.2），check 全部动作通过', r.mapped.attack === 'Slash' && r.mapped.fade === 0.2 && r.mapped.ok.length === 0, JSON.stringify(r.mapped));
      check('go 切换按 fade 交叉淡入，过完只剩 walk', r.mid.idle > 0 && r.mid.walk > 0 && r.after.state === 'walk' && r.after.weights.walk === 1 && !r.after.weights.idle, JSON.stringify({ mid: r.mid, after: r.after }));
      check('守卫：sync 驱动时帧时间推进 2 秒、go() 也抢不走，片段停在 t 映射的 0.3 秒，不发 anim:end', r.held.state === 'attack' && r.held.driven && Math.abs(r.held.time - 0.3) < 0.01 && r.held.t === 0.15 && Math.abs(r.top - r.topAgain) < 1e-4 && r.ends.length === 0, JSON.stringify({ held: r.held, ends: r.ends }));
      check('姿态跟着 t：t=0.15 手在最高（约 2.2），t=0.3 已砍下', r.top > 2.15 && r.down < r.top - 0.6, `top ${r.top.toFixed(3)} down ${r.down.toFixed(3)}`);
      check('sync(null) 交还控制后 go 照常（切回 idle）', r.back.state === 'idle', JSON.stringify(r.back));
      check('check 报缺：die 没有映射，改法指向清单 models.dummy.animation.states.die 并列出片段', r.missing.length === 1 && r.missing[0].includes('manifest "generated" models.dummy.animation.states.die') && r.missing[0].includes('Slash'), JSON.stringify(r.missing));
      check('清单写错：片段名 Slsh 提示 Slash 并指向清单条目', r.bad.some(w => w.includes('models.dummyBad.animation.states.attack') && w.includes('Slash')), JSON.stringify(r.bad));
      check('清单写错：键名 loops 开发时报错，提示 loop 并指向清单条目', r.typo.includes('models.dummyTypo.animation.states.attack') && r.typo.includes('loops') && r.typo.includes('`loop`'), r.typo);
      check('角色用这个模型：清单映射的 Idle_Armed 不被默认 Idle 盖掉，fade 用清单的', r.ch.idle === 'Idle_Armed' && r.ch.fade === 0.2, JSON.stringify(r.ch));
    },
  },
];
