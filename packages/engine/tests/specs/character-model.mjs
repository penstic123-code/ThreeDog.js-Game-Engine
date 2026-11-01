// 角色模型按资源名：Character({ model: '名字' }) 先用灰胶囊占位，加载完换上真模型和 Animator（身体是资源，风格不再给身体）。
// 用 tests/anim 的 king.glb（CC0）。覆盖：风格默认、单个角色覆盖、加载完前删除、未知名字立刻报错、加载失败保留占位只警告一次、两个角色共用一个资源各自动画。

export const specs = [
  {
    name: '角色模型按资源名：占位→换上、覆盖默认、提前删除、未知名报错、失败保留占位、共用资源各自动画',
    url: '/tests/anim/index.html',
    expectErrors: /404|Not Found|Failed to load resource|Couldn't load/,   // 故意缺的文件 broken.glb
    async run({ page, check, ev }) {
      await page.waitForFunction(() => window.ready === true, null, { timeout: 20000 });
      const r = await ev(async () => {
        engine.pause();
        const { Character } = window, A = engine.assets;
        const kingUrl = A.entries.get('king').url;   // king is already loaded by the page; king3 / king4 are fresh (uncached) names for the placeholder sections
        A.manifest({ models: { king2: kingUrl, king3: kingUrl + '?spec=3', king4: kingUrl + '?spec=4', broken: new URL('/tests/anim/public/broken.glb', location.href).href }, name: 'character-model-spec' });
        const events = []; engine.events.on('character:model', ({ character }) => events.push(character));
        const make = o => { const c = new Character(engine, o).addTo(); c.placeAt({ x: 2, z: 0 }); engine.onFrame(dt => c.animate(dt)); return c; };
        const hasModel = c => !!c.root.children.find(o => o.userData.animations?.length);
        const out = {};

        // console.warn captured over the whole run; only the broken-model warnings are checked (section 5)
        const { warns } = await __t.warns(async () => {
          // 1. 按名字：先占位，加载完换上
          const a = make({ model: 'king3' }); a.face(1.2);
          out.pending = { ready: a.ready, anim: !!a.anim, rig: !!a.root.children.length, model: hasModel(a) };
          await a.whenReady; engine.step(0.3);
          out.swapped = { ready: a.ready, model: hasModel(a), children: a.root.children.length, anim: a.anim?.state, clip: a.anim?.describe().clip, x: a.position.x, facing: a.root.rotation.y, event: events.includes(a) };

          // 2. a second name loads its own asset
          const u0 = A.users('king2'), b = make({ model: 'king2' }); await b.whenReady;
          out.override = { king2: A.users('king2') - u0, model: hasModel(b) };

          // 3. removed before loading finished: nothing reaches the scene, the copy is released

          const kingUsers = A.users('king4'), sceneCount = () => { let n = 0; engine.scene.traverse(o => { if (o.userData.animations?.length) n++; }); return n; };
          const n0 = sceneCount(), d = make({ model: 'king4' }); d.dispose(); await d.whenReady; engine.step(0.1);
          out.early = { added: sceneCount() - n0, users: A.users('king4') - kingUsers, anim: d.anim ?? null, inScene: !!d.root.parent };


          // 4. unknown name throws at once with the registered names
          try { new Character(engine, { model: 'kng' }); out.unknown = 'no throw'; } catch (err) { out.unknown = err.message; }

          // 5. load failure keeps the placeholder; two characters on the same broken asset warn once
          const f1 = make({ model: 'broken' }), f2 = make({ model: 'broken' });
          await Promise.all([f1.whenReady, f2.whenReady]);
          out.failed = { ready: f1.ready && f2.ready, anim: !!f1.anim, model: hasModel(f1), placeholder: f1.root.children.length === 1 && !f1.root.getObjectByName('placeholder'),
            event: events.includes(f1) };

          // 6. two characters sharing one asset animate independently
          const c1 = make({ model: 'king' }), c2 = make({ model: 'king' }); await Promise.all([c1.whenReady, c2.whenReady]);
          c1.state = 'walk'; c1.moveAmount = 2; engine.step(0.6);
          const m1 = c1.root.children.find(o => o.userData.animations), m2 = c2.root.children.find(o => o.userData.animations);
          const s1 = m1.getObjectByProperty('isSkinnedMesh', true).skeleton, s2 = m2.getObjectByProperty('isSkinnedMesh', true).skeleton;
          out.shared = { states: [c1.anim.state, c2.anim.state], mixers: c1.anim.mixer !== c2.anim.mixer, bones: s1.bones[0] !== s2.bones[0],
            pose: s1.bones.some((bn, i) => bn.quaternion.angleTo(s2.bones[i].quaternion) > 0.01) };


          for (const c of [a, b, f1, f2, c1, c2]) c.dispose();
        });
        out.failed.warns = warns.filter(m => m.includes('Character model "broken"')).length;
        return out;
      });
      check('按名字：建出时是占位身体、ready=false、还没有 anim', r.pending.ready === false && !r.pending.anim && r.pending.rig && !r.pending.model, JSON.stringify(r.pending));
      check('加载完换上真模型（占位被拿掉），Animator 播 idle，位置朝向不变，发 character:model',
        r.swapped.ready && r.swapped.model && r.swapped.children === 1 && r.swapped.anim === 'idle' && r.swapped.clip === 'Idle' && r.swapped.x === 2 && Math.abs(r.swapped.facing - 1.2) < 1e-6 && r.swapped.event, JSON.stringify(r.swapped));
      check('另一个名字用自己的资源', r.override.king2 === 1 && r.override.model, JSON.stringify(r.override));
      check('加载完前删除：场景里不多出模型，副本计数归还', r.early.added === 0 && r.early.users === 0 && r.early.anim === null && !r.early.inScene, JSON.stringify(r.early));
      check('未知名字立刻报错并列出已注册的名字', /"kng"/.test(r.unknown) && /king/.test(r.unknown) && /broken/.test(r.unknown), r.unknown);
      check('加载失败保留占位身体、不发事件，同名只警告一次', r.failed.ready && !r.failed.anim && !r.failed.model && r.failed.placeholder && r.failed.warns === 1 && !r.failed.event, JSON.stringify(r.failed));
      check('两个角色共用一个资源：各自骨骼、各自 mixer、各自状态和姿态', r.shared.states[0] === 'walk' && r.shared.states[1] === 'idle' && r.shared.mixers && r.shared.bones && r.shared.pose, JSON.stringify(r.shared));
    },
  },
  {
    // [守] 身体是资源不是风格：这条守住"不许绕开"——风格里再写 style.character.create / model / colors 必须抛 renamed-api，
    // 程序身体只能走 { model: 'humanoid' } 这一条路（和 GLB 同一个入口）；没有 model 就是灰胶囊。
    name: '[守] 角色身体是资源：humanoid 按名字立刻建好（关节、肢体摆动）、风格按材质角色上色、colors 单个改色、旧的 style.character.* 抛 renamed-api',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { THREE, Character, createEngine, lowpoly, lowpolyAssets } = threedogTest, out = {};
        const mk = (style, key) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key, style });
        const hex = (ch, name) => ch.root.getObjectByName(name)?.material.color.getHex();
        const a = mk(lowpoly, 'body-a'); a.assets.manifest(lowpolyAssets);
        const p = new Character(a, { model: 'humanoid' }), q = new Character(a, { model: 'humanoid', colors: { body: 0xff0000 } });
        out.now = { ready: p.ready, joints: ['armL', 'armR', 'legL', 'legR'].every(k => p[k]?.isObject3D), hips: p.hips?.name, limbs: p.limbs.length, head: p.head?.name };
        out.tint = { p: hex(p, 'torso'), q: hex(q, 'torso'), qSkin: hex(q, 'face'), own: p.root.getObjectByName('torso').material !== q.root.getObjectByName('torso').material };
        p.state = 'walk'; p.moveAmount = 3; p.phase = 1; p.animate(0.1);
        out.swing = Math.abs(p.legL.rotation.x) > 0.05;
        const g = mk([lowpoly, { materials: { cloth: { color: 0x00ff00 } } }], 'body-g'); g.assets.manifest(lowpolyAssets);
        out.styleTint = hex(new Character(g, { model: 'humanoid' }), 'torso');
        const n = mk(lowpoly, 'body-n'), cap = new Character(n, {});
        out.capsule = { limbs: cap.limbs.length, meshes: (() => { let k = 0; cap.root.traverse(o => { if (o.isMesh) k++; }); return k; })() };
        try { new Character(n, { model: 'humanoid' }); out.unknown = 'no throw'; } catch (e) { out.unknown = e.message; }
        out.old = ['create', 'model', 'colors'].map(k => {
          const e = mk([lowpoly, { character: { [k]: k === 'create' ? () => null : k === 'model' ? 'hero' : { body: 1 } } }], 'body-old-' + k);
          try { new Character(e, {}); return 'no throw'; } catch (err) { return err.code; }
        });
        for (const e of [a, g, n]) e.dispose();
        return out;
      });
      check('humanoid 按名字同步建好：ready、四个关节、hips/head、四条肢体', r.now.ready && r.now.joints && r.now.hips === 'hips' && r.now.head === 'head' && r.now.limbs === 4, JSON.stringify(r.now));
      check('风格的材质角色给颜色（lowpoly cloth），colors 只改这一个角色且是自己的材质', r.tint.p === 0xd9774a && r.tint.q === 0xff0000 && r.tint.qSkin === 0xf1c9a5 && r.tint.own, JSON.stringify(r.tint));
      check('走路时腿在摆（rig 从资源的 userData.rig 读回来）', r.swing, String(r.swing));
      check('别的风格改 materials.cloth 就给所有 humanoid 换色', r.styleTint === 0x00ff00, String(r.styleTint));
      check('没有 model：灰胶囊（一个网格、没有肢体）', r.capsule.limbs === 0 && r.capsule.meshes === 1, JSON.stringify(r.capsule));
      check('没注册资源包就用 humanoid：立刻报错并指向 lowpoly 的 assets', /"humanoid"/.test(r.unknown) && /lowpoly/.test(r.unknown), r.unknown);
      check('旧的 style.character.create / model / colors 都抛 renamed-api', r.old.every(c => c === 'renamed-api'), JSON.stringify(r.old));
    },
  },
];
