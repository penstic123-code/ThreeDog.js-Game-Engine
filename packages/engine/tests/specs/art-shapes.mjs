// 美术自由第 3 步：形状归风格包。city 页 style 是空对象（看兜底），world 页装 lowpoly（看风格包给的形状）。
// [守] 防止以后有人把低模小人、八面体拾取物、分面着色又写回引擎模块里，或让地形网格丢掉 uv、地形材质又变成换不了。

export const specs = [
  {
    name: '[守] 形状归风格包：不装风格包时角色是灰色胶囊，不强制分面',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        const { Character } = threedogTest;
        const c = new Character(engine, {}), meshes = [];
        c.root.traverse(o => { if (o.isMesh) meshes.push(o); });
        return { n: meshes.length, capsule: meshes[0]?.geometry.type, limbs: c.limbs.length, armL: 'armL' in c, flat: !!meshes[0]?.material.flatShading };
      });
      check('兜底角色只有一个胶囊网格，没有四肢', r.n === 1 && r.capsule === 'CapsuleGeometry' && r.limbs === 0 && !r.armL, JSON.stringify(r));
      check('兜底角色不强制分面', !r.flat);
    },
  },
  {
    name: '[守] 形状归风格包：lowpoly 给人形和八面体；地形块有 uv、材质可换；植被可用多材质模型（砍树各组一起藏）',
    url: '/tests/perf/index.html?mode=world',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE } = threedogTest, p = engine.player;
        const human = { limbs: p.limbs.length, joints: !!(p.armL?.isGroup && p.legR?.isGroup) };
        engine.inventory.define('artGem', { name: 'gem', color: 0x3366ff });
        const h = engine.inventory.spawnPickup('artGem', p.position);
        engine.step(0.5, { render: false });   // headless page: world builds the model on a step
        const obj = h.object;
        let geo = '';
        obj?.traverse(o => { if (o.isMesh) geo = o.geometry.type + ':' + o.material.flatShading; });
        h.remove();
        const chunk = [...engine.terrain.chunks.values()].find(c => c.terrain);
        const uv = chunk.terrain.geometry.attributes.uv, pos = chunk.terrain.geometry.attributes.position;
        // multi-material model: trunk + leaves meshes -> one InstancedMesh with two groups and a material array
        const model = new THREE.Group();
        model.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 2), new THREE.MeshLambertMaterial()));
        const leaves = new THREE.Mesh(new THREE.SphereGeometry(1), new THREE.MeshToonMaterial()); leaves.position.y = 2; model.add(leaves);
        const sp = engine.vegetation.add('artMulti', { model, wind: 0.02, rule: { perChunk: 30, maxSlope: 2, minHeight: -99, maxHeight: 999, avoidFlat: false } });
        return { human, geo, uv: !!uv && uv.count === pos.count, mats: Array.isArray(sp.material) && sp.material.length, groups: sp.geometry.groups.length,
          cloned: sp.material[1] !== leaves.material, wind: threedogTest.materialPatches(sp.material[1]).includes('wind') };
      });
      check('lowpoly 角色是带四肢的人形，关节挂在角色上（armL / legR）', r.human.limbs === 4 && r.human.joints, JSON.stringify(r.human));
      check('lowpoly 拾取物是分面八面体', r.geo === 'OctahedronGeometry:true', r.geo);
      check('地形块带 uv，每个顶点一个', r.uv);
      check('多材质模型：两个材质、两个几何组，材质是克隆的、加上了风吹', r.mats === 2 && r.groups === 2 && r.cloned && r.wind, JSON.stringify(r));
      const f = await ev(async () => {
        for (let i = 0; i < 30 && ![...engine.terrain.chunks.values()].some(c => c.veg.artMulti?.count); i++) { engine.step(0.1, { render: false }); await new Promise(res => setTimeout(res, 50)); }
        for (const c of engine.terrain.chunks.values()) {
          const im = c.veg.artMulti;
          if (!im || !im.count) continue;
          const id = im.userData.ids[0];
          engine.vegetation.removeInstance('artMulti', c.cx, c.cz, id);
          const m = im.instanceMatrix.array.slice(0, 16);
          return { draws: Array.isArray(im.material) && im.material.length, hidden: m.every(v => v === 0), depth: !!im.customDepthMaterial?.isMeshDepthMaterial };
        }
        return null;
      });
      check('多材质植被长出来了：一个 InstancedMesh 带材质数组', f && f.draws === 2, JSON.stringify(f));
      check('砍掉一棵后整棵（所有组）都藏了', f?.hidden);
      check('多材质植被也有摆动影子', f?.depth);
    },
  },
  // [守] 灯和时间不挂在 sky 上：防止有人把灯搬回 sky（不装 sky 场景全黑），或把倍速挂回 sky
  {
    name: '[守] 灯与 sky 脱开：不装 sky 也有默认灯；游戏时间倍速在 clock 上',
    url: '/tests/perf/index.html?mode=engine',
    async run({ check, ev }) {
      const r = await ev(() => {
        // the cube page adds its own lights too, so check the engine's pair is in the scene
        const L = engine.lights, lights = L.sun.isDirectionalLight && L.hemi.isHemisphereLight && L.sun.parent === engine.scene && L.hemi.parent === engine.scene;
        const t0 = engine.clock.now; engine.clock.timeScale = 0; engine.step(0.5, { render: false });
        const stopped = engine.clock.now === t0; engine.clock.timeScale = 3; engine.step(0.5, { render: false });
        const fast = Math.abs(engine.clock.now - t0 - 1.5) < 0.05; engine.clock.timeScale = 1;
        return { sky: !!engine.sky, lights, stopped, fast };
      });
      check('没装 sky 时引擎自带的方向光和半球光在场景里', !r.sky && r.lights, JSON.stringify(r));
      check('clock.timeScale = 0 停住游戏时间，= 3 三倍速', r.stopped && r.fast);
    },
  },
  {
    name: '[守] 灯与 sky 脱开：装了 sky 驱动的就是 engine.lights 的两盏灯',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const s = await ev(() => { let n = 0; engine.scene.traverse(o => { if (o.isDirectionalLight) n++; }); return { same: engine.sky.sun === engine.lights.sun && engine.sky.hemi === engine.lights.hemi, n }; });
      check('sky.sun / hemi 就是 engine.lights 的两盏，场景里只有一盏方向光', s.same && s.n === 1, JSON.stringify(s));
    },
  },
  {
    name: '[guard] the engine ships no art: no style pack, model or generator gives gray placeholders (capsule, box, flat ground at y = 0, plain lights) and one warning each with the fix',
    url: '/tests/placeholders/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const W = window.placeholderWarns, has = s => W.filter(w => w.includes(s)).length;
        const hs = [[0, 0], [37, -81], [-120, 64]].map(([x, z]) => engine.surface(x, z));
        const obj = window.gemPickup.object;
        let box = ''; obj?.traverse?.(o => { if (o.isMesh) box = o.geometry.type; });
        const chunk = [...engine.terrain.chunks.values()].find(c => c.terrain), col = chunk?.terrain.geometry.attributes.color;
        const gray = !!col && [...col.array.slice(0, 30)].every((v, i, a) => Math.abs(v - a[i - i % 3]) < 1e-6);
        let caps = 0; engine.player.root.traverse(o => { if (o.isMesh && o.geometry.type === 'CapsuleGeometry') caps++; });
        return { hs, type: engine.groundType(5, 5), box, gray, caps, shadow: engine.lights.sun.castShadow, tone: engine.renderer.toneMapping,
          warns: { style: has('no style pack given'), terrain: has('terrain(): no height function'), chars: has('characters: no style pack / model given'), pickups: has('pickups: no style pack / model given') } };
      });
      check('flat ground at y = 0 everywhere, ground type "default"', r.hs.every(h => h === 0) && r.type === 'default', JSON.stringify(r.hs) + ' ' + r.type);
      check('player is one gray capsule, the pickup a box, the ground one neutral gray', r.caps === 1 && r.box === 'BoxGeometry' && r.gray, JSON.stringify(r));
      check('placeholder lights: no shadows, no tone mapping', r.shadow === false && r.tone === 0, JSON.stringify(r));
      check('each missing piece warns exactly once (style, terrain, characters, pickups)', Object.values(r.warns).every(n => n === 1), JSON.stringify(r.warns));
    },
  },
];
