// Terrain and vegetation data / drawing split, can't-bypass checks: both drawings are replaceable without touching play; a density change keeps collision; hlod never
// draws a building the game hid. Run on both renderers (WebGL and renderer: 'webgpu'): the split must not depend on which one draws.
// The failed-chunk report has its own spec (terrain-chunk-failed.mjs) because it must not wait for start().
const PAGE = '/tests/terrain-edit/index.html';

// in the page: build the engines on the given renderer and return the numbers the checks read
async function parts(renderer) {
  // every await has a time limit, so a hang names its stage instead of timing out the whole page
  const out = {}, within = (p, stage) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('stuck at ' + stage)), 20000))]);
  try { await partsIn(renderer, out, within); } catch (err) { out.error = String(err?.message ?? err); }
  return out;
  async function partsIn(renderer, out, within) {
    const { createEngine, terrain, vegetation, hlod, THREE, loadTsl } = threedogTerrain;
    if (renderer === 'webgpu') await loadTsl();
    // a fresh canvas per engine: dispose() releases the context of the one it drew on
    const opts = () => renderer === 'webgpu' ? { canvas: Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), renderer: 'webgpu', pixelRatio: 1, adaptiveResolution: false }
      : { canvas: document.createElement('canvas'), headless: true };
    const mk = key => createEngine({ ...opts(), ui: { loading: false }, urlState: false, saveKey: key, threads: false });
    const height = (x, z) => Math.sin(x * 0.1) * 2 + z * 0.05;
    // 1. replace the picture: a game module that provides 'terrain-draw' and draws chunk data its own way
    const E = mk('terrain-split');
    E.use(terrain({ height, viewChunks: 2 }), vegetation());
    E.vegetation.define('tree', { geometry: new THREE.BoxGeometry(1, 3, 1), rule: { perChunk: 30, collider: 0.4 } });
    const drawn = new Map(), mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    E.use({ name: 'myGround', type: 'picture', provides: ['terrain-draw'], install(e, ctx) {
      ctx.track(e.terrain.view({
        add(c) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(c.data.pos, 3)); const m = new THREE.Mesh(g, mat); e.scene.add(m); drawn.set(c, m); },
        remove(c) { const m = drawn.get(c); if (m) { e.scene.remove(m); m.geometry.dispose(); drawn.delete(c); } },
      }));
    }, describe() { return {}; } }, { replaces: 'terrain-draw' });
    // and the plants: a game module that provides 'vegetation-draw' and only counts what it is told to draw
    const planted = new Map(), felled = [];
    E.use({ name: 'myPlants', type: 'picture', provides: ['vegetation-draw'], install(e, ctx) {
      ctx.track(e.vegetation.view({
        change(c, name) { planted.set(c.key + ':' + name, c.plants[name]?.n ?? 0); if (c.hidden?.[name]) felled.push(c.key); },
        drop(c) { for (const k of [...planted.keys()]) if (k.startsWith(c.key + ':')) planted.delete(k); },
      }));
    }, describe() { return {}; } }, { replaces: 'vegetation-draw' });
    await within(E.start(), 'start E');
    E.haltLoop?.();
    for (let i = 0; i < 80 && !E.ground.chunkCollision(0, 0); i++) E.step(1 / 60, { describe: false });
    out.lookGone = !E.terrainDraw;
    out.drawn = drawn.size > 0 && [...drawn.values()].every(m => m.material === mat);
    const col = E.ground.chunkCollision(0, 0);
    out.collision = !!col && col.positions.length > 0;
    out.surface = Math.abs(E.surface(3, 4) - height(3, 4)) < 0.3;
    let trees = 0; E.ground.forEachCollider(16, 16, 40, () => trees++);
    out.trees = trees;
    // plants with the picture replaced: the game's picture was told every placement, the engine drew none, felling still hides and frees a trunk
    let engineMeshes = 0; E.scene.traverse(o => { if (o.isInstancedMesh) engineMeshes++; });
    const hit = E.vegetation.instanceAt({ x: 16, z: 16 }, { radius: 40 });
    if (hit) E.vegetation.removeInstance(hit.species, hit.cx, hit.cz, hit.id);
    let treesFelled = 0; E.ground.forEachCollider(16, 16, 40, () => treesFelled++);
    out.plants = { gone: !E.vegetationDraw, told: [...planted.values()].reduce((a, b) => a + b, 0), engineMeshes, felled: felled.length > 0, trunk: treesFelled === trees - 1 };
    if (hit) E.vegetation.restoreInstance(hit.species, hit.cx, hit.cz, hit.id);
    // 2. density change: the ground keeps its collision token (no rebuild), trees still collide afterwards
    const tok = col?.token, treeTok = E.ground.chunkCollision(0, 0)?.treeToken;   // read again: felling and restoring above made a new one
    E.terrain.setDensity(0.5);
    // the new placement comes back from the chunk lane between tasks, so yield between steps
    for (let i = 0; i < 100 && E.ground.chunkCollision(0, 0)?.treeToken === treeTok; i++) { E.step(1 / 60, { describe: false }); await new Promise(res => setTimeout(res, 0)); }
    const col2 = E.ground.chunkCollision(0, 0);
    let trees2 = 0; E.ground.forEachCollider(16, 16, 40, () => trees2++);
    out.trees2 = trees2;
    out.densityKeeps = !!col2 && col2.token === tok && col2.treeToken !== treeTok && trees2 > 0 && trees2 < trees;
    E.dispose();
    // 3. hlod: a building the game hides (its parent group) is not drawn far away by the merged proxy
    const H = mk('terrain-split-h');
    H.use(hlod({ level: false }));
    await within(H.start(), 'start H');
    H.haltLoop?.();
    const house = new THREE.Group(), wall = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), new THREE.MeshBasicMaterial());
    house.add(wall); house.position.set(400, 0, 0); H.scene.add(house);
    const h = H.hlod.add(house, { near: 50 });
    // hlod merges in engine.jobs, which run on frames: a headless or paused engine gets them from step()
    for (let i = 0; i < 200 && !h.ready; i++) { H.step(1 / 60, { describe: false }); await new Promise(res => setTimeout(res, 0)); }
    await within(h.whenReady, 'hlod whenReady');
    H.hlod.update();
    const farBefore = h.cells[0].far;
    house.visible = false; H.hlod.update();
    out.hlod = farBefore && !h.cells[0].far && h.cells[0].proxy.every(p => !p.visible);
    house.visible = true; H.hlod.update();
    out.hlodBack = h.cells[0].far;
    H.dispose();
  }
}

function checks(check, r, tag) {
  const s = JSON.stringify(r);
  check(`${tag} 换掉外观：内置外观模块走了，游戏的外观画出了块（用自己的材质）`, r.lookGone && r.drawn, s);
  check(`${tag} 换掉外观：碰撞、高度、树的碰撞圈照旧`, r.collision && r.surface && r.trees > 0, s);
  check(`${tag} 换掉植被外观：游戏的外观收到每块的摆放、引擎不画；砍树照样藏起来并去掉树干碰撞`, r.plants?.gone && r.plants.told > 0 && r.plants.engineMeshes === 0 && r.plants.felled && r.plants.trunk, s);
  check(`${tag} 改密度：地面碰撞不重建，树重新摆放且仍有碰撞`, r.densityKeeps, s);
  check(`${tag} hlod：游戏藏起来的楼不会被远处代理画出来，显示回来后恢复合批`, r.hlod && r.hlodBack, s);
}

export const specs = [
  {
    name: '[守] 地形拆分：换掉地形和植被外观后碰撞、高度、砍树照旧；改密度地面碰撞不丢；hlod 不画游戏藏起来的楼',
    url: PAGE,
    async run({ check, ev }) {
      checks(check, await ev(parts, 'webgl'), 'WebGL');
    },
  },
  {
    name: '[守] 地形拆分（WebGPU 路线）：换掉地形和植被外观后碰撞照旧；改密度地面碰撞不丢；hlod 不画游戏藏起来的楼',
    url: PAGE,
    software: true,
    async run({ check, ev }) {
      checks(check, await ev(parts, 'webgpu'), 'WebGPU');
    },
  },
];
