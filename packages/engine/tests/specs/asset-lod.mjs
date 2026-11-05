// Model LOD, both halves: `threedog assets optimize --lod` (tools/assets-lod.mjs, run here in Node on a model made for the test) and engine.assets.lod / a prop's `lod`
// (core/assetLod.js, on tests/lod/). The guards are what a shortcut would break: levels stay opt-in, the full model answers rays and collision, batching and hlod keep out.
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);

/** A bumpy sheet of n x n quads with a textured-looking material, as a glb on disk */
async function bumpySheet(path, n) {
  const { Document, NodeIO } = req('@gltf-transform/core');
  const doc = new Document(), buf = doc.createBuffer(), pos = [], uv = [], idx = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) { pos.push(x / n, Math.sin(x / 3) * Math.cos(y / 5) * 0.05, y / n); uv.push(x / n, y / n); }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x, b = a + n + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv)))
    .setIndices(acc('SCALAR', new Uint32Array(idx))).setMaterial(doc.createMaterial('look'));
  doc.createScene().addChild(doc.createNode('sheet').setMesh(doc.createMesh('sheet').addPrimitive(prim)));
  await new NodeIO().write(path, doc);
  return doc;
}

const page = run => async ({ page: p, check, ev }) => {
  await p.waitForFunction(() => window.ready, null, { timeout: 60000 });
  run(await ev(() => window.lodRun()), check);
};
const engineChecks = (r, check) => {
  const s = JSON.stringify(r);
  check('off by default: model() downloads no level, lod() downloads them', r.levelsAfterModel === 0 && r.levelsAfterLod === 2, s);
  check('a plain THREE.LOD with the full model and two levels, distances rising with no number from the game', r.isLod && r.levels === 3 && r.defaults[0] === 0 && r.defaults[1] > 0 && r.defaults[2] > r.defaults[1], s);
  check('the renderer switches it: full near, last level far', r.near === 0 && r.far === 2, s);
  check('a shadow camera far away does not move the level (WebGPU calls update with it)', r.afterShadowCamera === 0, s);
  check('a level draws with the material of its full mesh', r.sameMaterial, s);
  check('distances can be changed', r.own.join() === '0,5,9', s);
  check('rays: statics hold the full meshes and no level', r.statics.full && !r.statics.low, s);
  check('rays: far away the full model is not drawn, by layer with visible true and no field of its own, and is still the one hit', !r.far0.drawn && r.far0.visible && !r.far0.field && r.rayHitsFull, s);
  check("a game's own Raycaster never hits a level, and far off still reaches the full model", r.ownRay.hits > 0 && !r.ownRay.twice && r.ownRay.low === 0 && r.ownRay.full, s);
  check('a copy taken far off: same far state, rays and a game Raycaster hit its full model', r.clone.far > 0 && !r.clone.farDrawn && r.clone.rayFull && r.clone.ownFull, s);
  check('near again: the old mask back with what the game enabled meanwhile, and a game Raycaster gets the same hits as far off', r.nearAgain === 0 && r.backMask === (1 | 1 << 4) && r.nearOwn.hits === r.ownRay.hits && !r.nearOwn.twice, s);
  check('collision.addObject measures the full model, not a level that sticks out of it', r.collisionHalf.got === r.collisionHalf.want, s);
  check('batching: plain copies batch, LOD copies never do, and none of their meshes is moved to the batch layer', r.plainBatched > 0 && r.lodBatched === 0 && r.lodLayers, s);
  check('hlod takes the plain mesh and leaves the LOD object alone', r.hlodOriginals.join() === 'mesh', s);
  check('a prop opts in with one word and its record stays plain data', r.prop.built === 1 && r.prop.distances.join() === '0,5,9' && r.prop.batch === false && /"lod":\[5,9\]/.test(r.prop.record), s);
  check('a model with no levels stays one level', r.noLevels === 1, s);
  check('falling distances are refused and say how to write them', /rising positive meters/.test(r.bad ?? ''), s);
  check("threePatches.off('lod-view-camera'): a LOD made after it keeps three's own update and clone", r.offPlain === true, s);
};

export const specs = [
  {
    name: '[guard] assets optimize --lod: levels hold fewer triangles, no look, the same primitives; skips say why',
    url: '/tests/lod/',
    async run({ check }) {
      const { buildLevels, lodSkipReason, parseRatios, triangleCount } = await import('@threedog/tools/assets-lod');
      const dir = mkdtempSync(join(tmpdir(), 'threedog-lod-')), file = join(dir, 'sheet.glb');
      try {
        const small = await bumpySheet(join(dir, 'small.glb'), 4);
        check('a small model is skipped and says so', /already small \(32 triangles\)/.test(lodSkipReason(small) ?? ''), lodSkipReason(small));
        const skinned = await bumpySheet(join(dir, 'skinned.glb'), 40);
        check('a big plain model is not skipped', lodSkipReason(skinned) === null, lodSkipReason(skinned));
        skinned.createSkin('rig');
        check('a skinned model is skipped and says so', /skinned/.test(lodSkipReason(skinned) ?? ''), lodSkipReason(skinned));
        let bad = null; try { parseRatios('0.2,0.5'); } catch (e) { bad = e.message; }
        check('rising shares are refused', /falling shares/.test(bad ?? ''), bad);

        await bumpySheet(file, 40);
        const out = await buildLevels(file, dir, 'sheet', [0.5, 0.2]);
        check('the report has triangles per level, falling', out.triangles.length === 3 && out.triangles[0] === 3200 && out.triangles[1] < 3200 * 0.9 && out.triangles[2] < out.triangles[1], JSON.stringify(out));
        check('one file per level', out.files.join() === 'sheet.lod1.glb,sheet.lod2.glb' && readdirSync(dir).includes('sheet.lod2.glb'), JSON.stringify(out));
        const doc = await new (req('@gltf-transform/core').NodeIO)().read(join(dir, 'sheet.lod1.glb')), root = doc.getRoot(), prims = root.listMeshes().flatMap(m => m.listPrimitives());
        check('a level holds no material and no texture: the look comes from the full model', root.listMaterials().length === 0 && root.listTextures().length === 0, String(root.listMaterials().length));
        check('a level keeps its primitives and UVs, which is what the engine pairs by', prims.length === 1 && !!prims[0].getAttribute('TEXCOORD_0') && triangleCount(doc) === out.triangles[1], String(prims.length));
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  },
  { name: '[guard] model LOD on WebGLRenderer: opt-in, plain THREE.LOD, full model for rays, batching and hlod keep out', url: '/tests/lod/index.html', software: true, run: page(engineChecks) },
  { name: '[guard] model LOD on WebGPURenderer: opt-in, plain THREE.LOD, full model for rays, batching and hlod keep out', url: '/tests/lod/index.html?r=gpu', software: true, run: page(engineChecks) },
];
