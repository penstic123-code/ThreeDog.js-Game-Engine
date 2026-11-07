// engine.rigid.ragdoll（modules/rigid/ragdoll.js）。用真模型：手搓两根骨头测不出导出命名、绑定姿态和缩放带来的问题。
const SKELETONS = {
  mixamo: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].map(n => 'mixamorig:' + n),
  blender: ['hips', 'spine', 'chest', 'neck', 'head', 'shoulder.L', 'upper_arm.L', 'forearm.L', 'hand.L', 'shoulder.R', 'upper_arm.R', 'forearm.R', 'hand.R', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R', 'foot.R'],
  unreal: ['pelvis', 'spine_01', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'],
  bip: ['Bip01 Pelvis', 'Bip01 Spine', 'Bip01 Spine2', 'Bip01 Neck', 'Bip01 Head', 'Bip01 L Clavicle', 'Bip01 L UpperArm', 'Bip01 L Forearm', 'Bip01 L Hand', 'Bip01 R Clavicle', 'Bip01 R UpperArm', 'Bip01 R Forearm', 'Bip01 R Hand', 'Bip01 L Thigh', 'Bip01 L Calf', 'Bip01 L Foot', 'Bip01 R Thigh', 'Bip01 R Calf', 'Bip01 R Foot'],
  vrm: ['J_Bip_C_Hips', 'J_Bip_C_Spine', 'J_Bip_C_Chest', 'J_Bip_C_Neck', 'J_Bip_C_Head', 'J_Bip_L_Shoulder', 'J_Bip_L_UpperArm', 'J_Bip_L_LowerArm', 'J_Bip_L_Hand', 'J_Bip_R_Shoulder', 'J_Bip_R_UpperArm', 'J_Bip_R_LowerArm', 'J_Bip_R_Hand', 'J_Bip_L_UpperLeg', 'J_Bip_L_LowerLeg', 'J_Bip_L_Foot', 'J_Bip_R_UpperLeg', 'J_Bip_R_LowerLeg', 'J_Bip_R_Foot'],
};

export const specs = [
  {
    name: '[guard] ragdoll: reads skeletons, goes limp, settles unbroken, gives everything back, no leaks, same result twice',
    url: '/tests/ragdoll/index.html',
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready === true, null, { timeout: 30000 });
      const named = await ev(skeletons => {
        // 每份名单按"躯干链 → 头 / 四肢"搭成一棵树：名单的顺序就是 脊柱…颈、头、(肩 臂 前臂 手)×2、(大腿 小腿 脚)×2
        const build = names => {
          const bones = names.map(n => { const b = new THREE.Bone(); b.name = n; return b; });
          const neck = bones.findIndex(b => /neck/i.test(b.name)), head = neck + 1, chest = neck - 1;
          for (let i = 1; i <= head; i++) bones[i - 1].add(bones[i]);
          for (let i = head + 1; i < bones.length;) {
            const leg = /thigh|upleg|upperleg/i.test(bones[i].name), n = leg ? 3 : 4;
            (leg ? bones[0] : bones[chest]).add(bones[i]);
            for (let k = 1; k < n; k++) bones[i + k - 1].add(bones[i + k]);
            i += n;
          }
          return new THREE.Skeleton(bones);
        };
        const out = {};
        for (const [k, names] of Object.entries(skeletons)) { try { out[k] = Object.values(readBones(build(names))).map(b => b.name); } catch (e) { out[k] = e.message; } }
        const broken = build(skeletons.mixamo);
        broken.bones.find(b => /LeftLeg/.test(b.name)).name = 'Odd'; broken.bones.find(b => /RightForeArm/.test(b.name)).name = 'Odd2';
        try { readBones(broken); out.broken = 'no error'; } catch (e) { out.broken = e.message; }
        out.fixed = readBones(broken, { lowerLegL: 'Odd', lowerArmR: 'Odd2' }).lowerLegL.name;
        return out;
      }, SKELETONS);
      for (const k of Object.keys(SKELETONS)) check(`${k} skeleton read`, Array.isArray(named[k]) && named[k].length === 11 && new Set(named[k]).size === 11, JSON.stringify(named[k]));
      check('a skeleton it cannot read names the missing parts', /lowerLegL/.test(named.broken) && /lowerArmR/.test(named.broken) && /bones:/.test(named.broken), named.broken);
      check('the game\'s own bone map reads it', named.fixed === 'Odd', named.fixed);

      const r = await ev(async () => {
        engine.haltLoop();
        const p = engine.player, R = engine.rigid, rig = engine.cameraRig, skin = p.root.getObjectByProperty('isSkinnedMesh', true);
        const out = {}, base = () => ({ bodies: R.bodies.length, colliders: R.world.colliders.len(), rb: R.world.bodies.len(), joints: R.world.impulseJoints.len() });
        const V = THREE.Vector3;
        engine.step(0.5);
        out.base = base();
        // hips 的位置本来就由物理写，它到父骨的距离不算骨长
        const lengths = hips => { p.root.updateMatrixWorld(true); return skin.skeleton.bones.filter(b => b.parent?.isBone).map(b => (b === hips ? 0 : b.getWorldPosition(new V()).distanceTo(b.parent.getWorldPosition(new V())))); };
        const rd0 = R.ragdoll(p), hipsBone = rd0.parts.hips.object; rd0.remove();
        const len0 = lengths(hipsBone);
        const rd = R.ragdoll(p, { impulse: [150, 120, 250], position: p.root.position.clone().add(new V(0, 1.4, 0)) });
        out.again = R.ragdoll(p) === rd;
        const b0 = rd.parts.lowerLegL.object.quaternion.clone(), time0 = p.anim.mixer.time;
        out.during = { owner: engine.control.of(p).owner, state: p.state, camera: rig.target !== p.root, parts: Object.keys(rd.parts).length, joints: R.world.impulseJoints.len() };
        try { p.move(1, 0, false, 1 / 60); out.bypass = 'moved'; } catch (e) { out.bypass = e.code ?? e.message; }
        let maxV = 0, maxStretch = 0, maxLen = 0, nan = false, peak = -Infinity, low = Infinity, knee = 0;
        const Q = b => { const q = b.rotation(); return new THREE.Quaternion(q.x, q.y, q.z, q.w); };
        // 膝盖只往一个方向弯：关节坐标系里 bend 的角度不能明显为负（list 是内部字段，只有这里读）
        const shin = rd.list.find(x => x.name === 'lowerLegL'), kneeAngle = () => {
          const F = shin.shape.frame, f = Q(shin.parent.entry.body).invert().multiply(Q(shin.entry.body)).premultiply(F.clone().invert()).multiply(F);
          return 2 * Math.asin(f.z * (f.w < 0 ? -1 : 1));
        };
        const gap = () => {
          let g = 0;
          R.world.impulseJoints.forEach(j => {
            const a = j.body1(), b = j.body2(), qa = a.rotation(), ta = a.translation(), tb = b.translation(), an = j.anchor1();
            const w = new V(an.x, an.y, an.z).applyQuaternion(new THREE.Quaternion(qa.x, qa.y, qa.z, qa.w)).add(new V(ta.x, ta.y, ta.z));
            g = Math.max(g, w.distanceTo(new V(tb.x, tb.y, tb.z)));
          });
          return g;
        };
        for (let i = 0; i < 480; i++) {
          engine.step(1 / 60);
          for (const e of Object.values(rd.parts)) {
            const v = e.body.linvel(), t = e.body.translation();
            nan ||= !Number.isFinite(t.x + t.y + t.z);
            maxV = Math.max(maxV, Math.hypot(v.x, v.y, v.z)); peak = Math.max(peak, t.y); low = Math.min(low, t.y);
          }
          maxStretch = Math.max(maxStretch, gap()); knee = Math.min(knee, kneeAngle());
          if (i === 5) out.capsuleOff = !R.playerCollider.isEnabled();
          if (i % 40 === 0) lengths(hipsBone).forEach((x, k) => { maxLen = Math.max(maxLen, Math.abs(x - len0[k]) / (len0[k] || 1)); });
        }
        const hips = rd.parts.hips.body.translation();
        Object.assign(out, { knee, maxV, maxStretch, maxLen, nan, peak, low, settled: rd.settled, hipsY: hips.y, rootOff: Math.hypot(p.root.position.x - hips.x, p.root.position.z - hips.z), rootY: p.root.position.y,
          mixerStill: p.anim.mixer.time === time0, boneMoved: b0.angleTo(rd.parts.lowerLegL.object.quaternion) > 1e-4 });
        // 游戏仍然能读写骨骼：睡着后写的值留得住
        const head = rd.parts.head.object, keep = head.quaternion.clone().multiply(new THREE.Quaternion(0, 0.1, 0, 1).normalize());
        head.quaternion.copy(keep); engine.step(0.1); out.gameWrite = head.quaternion.equals(keep);
        rd.remove(); rd.remove();
        out.after = { active: rd.active, owner: engine.control.of(p).owner, state: p.state, camera: rig.target === p.root, height: rig.height, ...base() };
        const t1 = p.anim.mixer.time; engine.step(0.4);
        out.animBack = p.anim.mixer.time > t1;
        out.capsuleBack = R.playerCollider.isEnabled();
        const y0 = p.root.position.y; engine.step(0.1); out.standing = Math.abs(p.root.position.y - y0) < 0.01 && p.grounded;

        // 反复倒下：没有泄漏
        for (let i = 0; i < 25; i++) { const x = R.ragdoll(p, { impulse: [0, 50, 80] }); engine.step(0.1); x.remove(); engine.step(0.05); }
        out.cycles = base();

        // 世界重建：刚体被带过去，关节在 rigid:rebuilt 上建回来
        const r2 = R.ragdoll(p); engine.step(0.2);
        R._fresh();
        out.rebuilt = { active: r2.active, joints: R.world.impulseJoints.len() };
        engine.step(1);
        out.rebuiltOk = Number.isFinite(r2.parts.hips.body.translation().y) && r2.parts.hips.body.translation().y < 1.5;
        r2.remove();
        out.afterRebuild = base();

        // 不存档：存着时是布娃娃，读回来是正常角色
        const r3 = R.ragdoll(p); engine.step(0.5);
        engine.saves.save('rd');
        const at = p.root.position.clone();
        await engine.session.load('rd');
        engine.haltLoop(); engine.step(0.1);
        out.loadedAt = p.root.position.distanceTo(at);
        out.loaded = { limp: !!p.limp, active: r3.active, owner: engine.control.of(p)?.owner, state: p.state, joints: R.world.impulseJoints.len(), held: !!p.anim._held };

        const r4 = R.ragdoll(p); engine.step(0.2); await engine.saves.load('rd'); out.plainLoad = !r4.active && !p.limp;
        engine.step(0.1);

        // 不属于任何角色的模型，缩小一半：碰撞体用眼前的真实长度；模型删掉时物理跟着走
        const m = await engine.assets.model('king'); m.scale.setScalar(0.5); m.position.set(-3, 0, 0); engine.add(m);
        m.updateMatrixWorld(true);
        const r5 = R.ragdoll(m, { impulse: [0, 0, 40] });
        for (let i = 0; i < 300; i++) engine.step(1 / 60);
        out.bare = { hipsY: r5.parts.hips.body.translation().y, settled: r5.settled };
        engine.remove(m); engine.step(0.05);
        out.bareGone = { active: r5.active, ...base() };

        // 手搓角色走 rapier 移动器：它自己的胶囊让位又回来；中途 dispose 不留东西
        const m2 = await engine.assets.model('king'), c = new Character(engine, { model: m2, mover: 'rapier', id: 'rd-npc' });
        engine.add(c.root); c.placeAt([3, 0, 0]);
        const h = engine.control.take(c, { owner: 't', layer: 'script', step: () => null });
        engine.step(0.2);
        const r6 = R.ragdoll(c), offNpc = !c.mover.collider.isEnabled(); engine.step(0.3);
        r6.remove(); engine.step(0.1);
        out.npc = { offNpc, back: c.mover.collider.isEnabled(), owner: engine.control.of(c)?.owner };
        const r7 = R.ragdoll(c); engine.step(0.1); h.remove(); c.dispose(); engine.step(0.05);
        out.npcGone = { active: r7.active, ...base() };

        // an NPC's model torn down while limp: its slot lives on by id, so the ragdoll's hold has to go with the model
        const c3 = new Character(engine, { model: await engine.assets.model('king'), id: 'rd-far' });
        engine.add(c3.root); c3.placeAt([3, 0, 0]); c3.npcModel = true;
        R.ragdoll(c3); engine.step(0.05); c3.dispose(); engine.step(0.05);
        out.npcFar = engine.control.of('rd-far');

        // engine.dispose frees the physics world before world tears the NPC models down: the mover must not reach for it
        const c4 = new Character(engine, { model: await engine.assets.model('king'), mover: 'rapier', id: 'rd-late' });
        engine.add(c4.root); c4.placeAt([3, 0, 3]);
        const h4 = engine.control.take(c4, { owner: 't', layer: 'script', step: () => null });
        engine.step(0.1);
        const live = R.world; R.world = null; h4.remove();
        try { c4.dispose(); out.lateDispose = true; } catch (err) { out.lateDispose = err.message; }
        R.world = live;

        // 重击打在头上：轻的部位吃下全部冲量也不能飞散
        const r8 = R.ragdoll(p, { impulse: [0, 100, 1500], position: [p.root.position.x, 1.6, p.root.position.z] });
        let worst = 0, fast = 0;
        for (let i = 0; i < 120; i++) { engine.step(1 / 60); worst = Math.max(worst, gap()); for (const e of Object.values(r8.parts)) { const v = e.body.linvel(); fast = Math.max(fast, Math.hypot(v.x, v.y, v.z)); } }
        out.hard = { worst, fast };
        r8.remove(); p.placeAt([0, 0, 0]); engine.step(0.1);

        // 确定性：同样的起点、同样的冲量，走同样的固定步数，结果一位不差
        const run = () => {
          R._fresh(); p.placeAt([2, 0, 3]); p.face(0.7); engine.step(0.2); p.anim.mixer.setTime(0.3); p.root.updateMatrixWorld(true);
          const d = R.ragdoll(p, { impulse: [90, 40, -120], position: [2, 1.2, 3] }), y0 = d.parts.head.body.translation().y;
          for (let i = 0; i < 180; i++) engine.step(1 / 60);
          out.fell = y0 - d.parts.head.body.translation().y;
          const s = Object.values(d.parts).map(e => { const t = e.body.translation(), q = e.body.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w].join(); }).join('|');
          d.remove(); return s;
        };
        const a = run(), b = run();
        out.same = a === b;
        return out;
      });
      console.log('  ragdoll numbers:', JSON.stringify(r));
      check('ragdoll() twice returns the same ragdoll', r.again);
      check('while limp: control is the ragdoll\'s, the camera moved off the root, 11 parts, 10 joints', r.during.owner === 'ragdoll' && r.during.camera && r.during.parts === 11 && r.during.joints === 10 && r.during.state === 'ragdoll', JSON.stringify(r.during));
      check('a direct move() while limp is a control-bypass', /control-bypass/.test(String(r.bypass)), String(r.bypass));
      check('the player capsule is off while limp', r.capsuleOff);
      check('the mixer does not run while limp, the bones do', r.mixerStill && r.boneMoved, `${r.mixerStill} ${r.boneMoved}`);
      check('no explosion: finite, speed under 25 m/s, never above 4 m', !r.nan && r.maxV < 25 && r.peak < 4, `v ${r.maxV} peak ${r.peak}`);
      check('joints hold: worst anchor gap under 6 cm', r.maxStretch < 0.06, String(r.maxStretch));
      check('bones keep their length (mesh cannot stretch)', r.maxLen < 1e-3, String(r.maxLen));
      check('settles on the ground: asleep, hips low, nothing under the floor', r.settled && r.hipsY < 0.6 && r.low > -0.12, `${r.settled} hips ${r.hipsY} low ${r.low}`);
      check('the root follows the body', r.rootOff < 0.01 && Math.abs(r.rootY) < 0.15, `${r.rootOff} ${r.rootY}`);
      check('a game write to a bone stays while it rests', r.gameWrite);
      check('remove(): control, state, camera come back and nothing is left in the world', !r.after.active && r.after.owner === 'player-input' && r.after.state === 'idle' && r.after.camera && r.after.bodies === r.base.bodies && r.after.joints === 0 && r.after.colliders === r.base.colliders, JSON.stringify(r.after));
      check('the camera got its height back', r.after.height === 1.2, String(r.after.height));
      check('animation runs again, capsule on, stands', r.animBack && r.capsuleBack && r.standing, `${r.animBack} ${r.capsuleBack} ${r.standing}`);
      check('25 cycles leak nothing', r.cycles.bodies === r.base.bodies && r.cycles.rb === r.base.rb && r.cycles.colliders === r.base.colliders && r.cycles.joints === 0, JSON.stringify(r.cycles));
      check('a world rebuild keeps it and re-creates the joints', r.rebuilt.active && r.rebuilt.joints === 10 && r.rebuiltOk, JSON.stringify(r.rebuilt));
      check('nothing left after that either', r.afterRebuild.bodies === r.base.bodies && r.afterRebuild.joints === 0, JSON.stringify(r.afterRebuild));
      check('a load brings a normal character', !r.loaded.limp && !r.loaded.active && !r.loaded.held && r.loaded.owner === 'player-input' && r.loaded.joints === 0 && r.loaded.state !== 'ragdoll', JSON.stringify(r.loaded));
      check('a plain saves.load does too', r.plainLoad);
      check('the knee never bends backward', r.knee > -0.12, String(r.knee));
      check('a bare scaled model goes limp, and removing it frees the physics', r.bare.settled && r.bare.hipsY < 0.4 && !r.bareGone.active && r.bareGone.bodies === r.base.bodies && r.bareGone.joints === 0, JSON.stringify([r.bare, r.bareGone]));
      check('a rapier mover capsule yields and comes back; dispose while limp leaves nothing', r.npc.offNpc && r.npc.back && r.npc.owner === 't' && !r.npcGone.active && r.npcGone.bodies === r.base.bodies && r.npcGone.joints === 0, JSON.stringify([r.npc, r.npcGone]));
      check('an NPC model torn down while limp leaves no hold on its slot', r.npcFar === null, JSON.stringify(r.npcFar));
      check('a rapier character disposed after the physics world is gone throws nothing', r.lateDispose === true, String(r.lateDispose));
      check('a hard hit on the head holds together', r.hard.worst < 0.25, JSON.stringify(r.hard));
      check('same input, same result in fixed steps (and it really fell)', r.same && r.fell > 0.3, `${r.same} ${r.fell}`);
    },
  },
  {
    name: 'ragdoll on the real WebGPU backend: limp pose on the ground, screenshot',
    url: '/tests/ragdoll/index.html?gpu=1',
    software: false,
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
      const r = await ev(async () => {
        const R = engine.rigid, p = engine.player, rd = R.ragdoll(p, { impulse: [60, 80, 140], position: [0, 1.4, 0] });
        await new Promise(f => setTimeout(f, 4000));   // main-loop
        const t = rd.parts.head.body.translation();
        return { backend: window.backendOf(engine.renderer), head: t.y, limp: !!p.limp };
      });
      // 留档的那张在 docs/testing/field/2026-11-05-ragdoll/；要重拍时设 RAGDOLL_SHOT，平时不写，免得每次跑都弄脏工作区
      const shot = await page.screenshot(process.env.RAGDOLL_SHOT ? { path: process.env.RAGDOLL_SHOT } : {});
      console.log('  webgpu ragdoll:', JSON.stringify(r));
      if (r.backend !== 'webgpu') console.log(`  (no WebGPU adapter here: ran on ${r.backend})`);
      check('limp on the ground', r.limp && r.head < 0.9, String(r.head));
      check('a picture came out', shot.length > 5000, String(shot.length));
    },
  },
];
