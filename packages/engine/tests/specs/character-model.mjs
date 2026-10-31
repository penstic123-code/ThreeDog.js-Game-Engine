// 角色模型按资源名：style.character.model / Character({ model: '名字' }) 先用占位身体，加载完换上真模型和 Animator。
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
        const { Character } = engine.characters, A = engine.assets, style = engine.style.character ??= {};
        A.manifest({ models: { king2: A.entries.get('king').url, broken: new URL('/tests/anim/public/broken.glb', location.href).href } }, { name: 'character-model-spec' });
        const events = []; engine.events.on('character:model', ({ character }) => events.push(character));
        const make = o => { const c = new Character(engine, o).addTo(); c.placeAt({ x: 2, z: 0 }); engine.onFrame(dt => c.animate(dt)); return c; };
        const hasModel = c => !!c.root.children.find(o => o.userData.animations?.length);
        const out = {};

        // console.warn captured over the whole run; only the broken-model warnings are checked (section 5)
        const { warns } = await __t.warns(async () => {
          // 1. style default: placeholder now, swapped later, idle plays; position and facing kept
          const before = style.model; style.model = 'king';
          const a = make({}); a.face(1.2);
          out.pending = { ready: a.ready, anim: !!a.anim, rig: !!a.root.children.length, model: hasModel(a) };
          await a.whenReady; engine.step(0.3);
          out.swapped = { ready: a.ready, model: hasModel(a), children: a.root.children.length, anim: a.anim?.state, clip: a.anim?.describe().clip, x: a.position.x, facing: a.root.rotation.y, event: events.includes(a) };

          // 2. per-character string overrides the style default
          const u0 = A.users('king2'), b = make({ model: 'king2' }); await b.whenReady;
          out.override = { king2: A.users('king2') - u0, model: hasModel(b) };

          // 3. removed before loading finished: nothing reaches the scene, the copy is released
          const kingUsers = A.users('king'), sceneCount = () => { let n = 0; engine.scene.traverse(o => { if (o.userData.animations?.length) n++; }); return n; };
          const n0 = sceneCount(), d = make({}); d.dispose(); await d.whenReady; engine.step(0.1);
          out.early = { added: sceneCount() - n0, users: A.users('king') - kingUsers, anim: d.anim, inScene: !!d.root.parent };

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

          style.model = before;
          for (const c of [a, b, f1, f2, c1, c2]) c.dispose();
        });
        out.failed.warns = warns.filter(m => m.includes('Character model "broken"')).length;
        return out;
      });
      check('风格默认名：建出时是占位身体、ready=false、还没有 anim', r.pending.ready === false && !r.pending.anim && r.pending.rig && !r.pending.model, JSON.stringify(r.pending));
      check('加载完换上真模型（占位被拿掉），Animator 播 idle，位置朝向不变，发 character:model',
        r.swapped.ready && r.swapped.model && r.swapped.children === 1 && r.swapped.anim === 'idle' && r.swapped.clip === 'Idle' && r.swapped.x === 2 && Math.abs(r.swapped.facing - 1.2) < 1e-6 && r.swapped.event, JSON.stringify(r.swapped));
      check('单个角色的 model 名字覆盖风格默认', r.override.king2 === 1 && r.override.model, JSON.stringify(r.override));
      check('加载完前删除：场景里不多出模型，副本计数归还', r.early.added === 0 && r.early.users === 0 && r.early.anim === null && !r.early.inScene, JSON.stringify(r.early));
      check('未知名字立刻报错并列出已注册的名字', /"kng"/.test(r.unknown) && /king/.test(r.unknown) && /broken/.test(r.unknown), r.unknown);
      check('加载失败保留占位身体、不发事件，同名只警告一次', r.failed.ready && !r.failed.anim && !r.failed.model && r.failed.placeholder && r.failed.warns === 1 && !r.failed.event, JSON.stringify(r.failed));
      check('两个角色共用一个资源：各自骨骼、各自 mixer、各自状态和姿态', r.shared.states[0] === 'walk' && r.shared.states[1] === 'idle' && r.shared.mixers && r.shared.bones && r.shared.pose, JSON.stringify(r.shared));
    },
  },
];
