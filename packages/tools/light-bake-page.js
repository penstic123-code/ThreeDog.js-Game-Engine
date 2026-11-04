// `threedog bake light`, the part that runs in the game's own page (bake-light.mjs injects it). Why a second renderer on a copy of the scene: three's LightMapper
// only runs on WebGPURenderer, and a WebGL game's materials cannot be drawn there. Baking needs surfaces, colors and lights, not the game's shaders, so plain node
// materials stand in; the same path serves WebGPU games, and the game's scene and geometry are not touched.
// Light source: a probe grid over the static meshes. Its cubes see the direct light on the surfaces, so the map holds sky and first bounce and the sun stays real-time.
// shortcut: bounce only from the grid, whose detail is its spacing; the trial's best picture added a vxgi pass for the sun's bounce. Upgrade when a room needs sharper bounce.
import { WebGPURenderer, Scene, Mesh, Group, Box3, Vector3, Color, MeshStandardNodeMaterial } from 'three/webgpu';
import { LightMapper } from 'three/addons/lighting/LightMapper.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { lightProbeGridIrradiance } from 'three/addons/tsl/lighting/LightProbeGridNode.js';
import { unwrapUVs } from 'three/addons/utils/unwrapUVs.js';

const stand = m => new MeshStandardNodeMaterial({ color: m.color ?? 0xffffff, map: m.map ?? null, emissive: m.emissive ?? 0, emissiveIntensity: m.emissiveIntensity ?? 1, emissiveMap: m.emissiveMap ?? null, side: m.side });
const mats = o => Array.isArray(o.material) ? o.material : [o.material];
const proxyOf = o => { const p = new Mesh(o.geometry, Array.isArray(o.material) ? o.material.map(stand) : stand(o.material)); p.matrixAutoUpdate = false; p.matrix.copy(o.matrixWorld); p.castShadow = o.castShadow; p.receiveShadow = o.receiveShadow; p.name = o.name; return p; };

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** Everything the bake needs from the game's scene: what is static, what cannot be baked, and why the bake must stop */
function pick(scene) {
  const meshes = [], skipped = [], names = new Set(), problems = [];
  scene.updateMatrixWorld(true);
  scene.traverseVisible(o => {
    if (!o.isMesh || !o.userData.static) return;
    if (o.isInstancedMesh || o.isBatchedMesh) { skipped.push({ name: o.name || o.type, why: 'instanced meshes cannot hold a lightmap: a probe grid lights them' }); return; }
    if (o.isSkinnedMesh) { skipped.push({ name: o.name || o.type, why: 'a skinned mesh moves' }); return; }
    if (!o.name) problems.push(`a static ${o.type} (${o.id}) has no name, and the file finds meshes by name`);
    else if (names.has(o.name)) problems.push(`two static meshes are named ${o.name}, and the file finds meshes by name`);
    names.add(o.name); meshes.push(o);
  });
  return { meshes, skipped, problems };
}

/** @param {{ size: number, spacing?: number, samples: number }} opts */
window.threedogBakeLight = async opts => {
  const e = window.engine, t0 = performance.now(), { meshes, skipped, problems } = pick(e.scene);
  if (problems.length) return { error: problems.join('; ') };
  if (!meshes.length) return { error: 'no mesh is marked static: set mesh.userData.static = true on what never moves, then bake again' };
  const r = new WebGPURenderer({ canvas: Object.assign(document.createElement('canvas'), { width: 16, height: 16 }) });
  await r.init();
  const backend = r.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  const gpu = adapter ? `${adapter.info?.vendor ?? ''} ${adapter.info?.architecture ?? ''} ${adapter.info?.description ?? ''}`.trim() : 'none';
  if (backend !== 'webgpu') return { error: `this browser has no real WebGPU (three fell back to WebGL2; adapter: ${gpu})`, backend, gpu };

  const scene = new Scene(), box = new Box3();
  for (const o of meshes) { scene.add(proxyOf(o)); box.expandByObject(o); }
  // moving things are left out on purpose; lights come as they are, and the game's hemisphere stands for the sky the cubes look at
  // (the page's background is a display color, far weaker than the sun: baked against it a room comes out black)
  scene.background = new Color(0);
  e.scene.traverseVisible(o => {
    if (o.isHemisphereLight) scene.background = o.color.clone().multiplyScalar(o.intensity);
    else if (o.isAmbientLight) scene.background = o.color.clone().multiplyScalar(o.intensity);
    else if (o.isDirectionalLight || o.isPointLight || o.isSpotLight) {
      const l = o.clone(false); l.matrixAutoUpdate = true; o.getWorldPosition(l.position); scene.add(l);
      if (o.target) { l.target = o.target.clone(false); o.target.getWorldPosition(l.target.position); scene.add(l.target); }
    }
  });

  const size = box.getSize(new Vector3()), spacing = opts.spacing ?? Math.max(size.x, size.y, size.z) / 12;
  const n = s => Math.max(2, Math.ceil(s / spacing));
  const grid = new LightProbeGrid(size.x + spacing, size.y + spacing, size.z + spacing, n(size.x), n(size.y), n(size.z));
  box.getCenter(grid.position); grid.updateBoundingBox();
  grid.bake(r, scene, { cubemapSize: 8, near: 0.05, far: size.length() * 2 });

  // unwrap copies: unwrapUVs replaces a mesh's geometry, and the game's meshes must stay as they are
  const root = new Group(), copies = meshes.map(proxyOf);
  root.add(...copies);
  for (const c of copies) { c.matrixAutoUpdate = true; c.matrix.decompose(c.position, c.quaternion, c.scale); }
  const atlas = unwrapUVs(root, { resolution: opts.size, padding: 4 });
  if (!atlas) return { error: `the meshes do not fit a ${opts.size} atlas: raise --size` };

  const mapper = new LightMapper(r, opts.size, (p, nrm) => lightProbeGridIrradiance(grid, p, nrm));
  mapper.addObjects(copies);
  mapper.update(opts.samples);
  // shortcut: reads mapper._renderTarget, three gives no public way to the target; a three.js update that renames it stops this bake with a clear TypeError
  const px = await r.readRenderTargetPixelsAsync(mapper._renderTarget, 0, 0, opts.size, opts.size);
  const row = px.length / opts.size, tex = new Uint16Array(opts.size * opts.size * 4);
  for (let y = 0; y < opts.size; y++) tex.set(px.subarray(y * row, y * row + opts.size * 4), y * opts.size * 4);

  // per mesh: which source vertex each new vertex came from, the new index, uv1
  let at = 0;
  const parts = [], table = [];
  atlas.meshes.forEach(({ mesh, sourceVertices }, i) => {
    const g = mesh.geometry, count = g.attributes.position.count, index = Uint32Array.from(g.index ? g.index.array : g.attributes.position.array.keys().take(count));
    const from = Uint32Array.from(sourceVertices), uv1 = Float32Array.from(g.attributes.uv1.array);
    table.push({ name: mesh.name, vertices: meshes[i].geometry.attributes.position.count, count, indices: index.length, at, matrix: Array.from(meshes[i].matrixWorld.elements) });
    parts.push(from, index, uv1); at += (from.length + index.length + uv1.length) * 4;
  });
  const lists = new Uint8Array(at);
  let w = 0;
  for (const p of parts) { lists.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), w); w += p.byteLength; }
  const meta = { format: 'threedog-lightmap', version: 1, size: opts.size, backend, meshes: table, skipped };
  const out = { meta, texture: toBase64(new Uint8Array(tex.buffer)), lists: toBase64(lists), backend, gpu, ms: Math.round(performance.now() - t0), warnings: atlas.warnings, probes: grid.resolution.toArray() };
  mapper.dispose(); grid.dispose(); r.dispose();
  return out;
};
window.threedogBakeLightReady = true;
