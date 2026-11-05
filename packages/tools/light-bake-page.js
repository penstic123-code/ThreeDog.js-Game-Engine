// `threedog bake light`, the part that runs in the game's own page (bake-light.mjs injects it). Why a second renderer on copies of the meshes: three's LightMapper
// only runs on WebGPURenderer, and a WebGL game's materials cannot be drawn there. Baking needs surfaces, colors and lights, not the game's shaders, so the same
// path serves both kinds of game, and the game's scene and geometry are not touched.
// Light source: rays, traced per lightmap texel through a BVH of the static meshes. A ray that leaves the scene brings the sky; a ray that hits a surface brings what
// that surface sends back. Why rays and not a probe grid: a grid does not know where walls are. Probes in or behind a wall see the sky, and interpolation spreads that
// along every wall base, while a pillar thinner than the spacing leaves no shadow at all. A ray cannot pass a wall, and it hits the pillar. The test for this is tests/specs/light-bake.mjs.
// What the map holds: sky and bounced light. The direct light of the game's lamps and sun lands on surfaces and bounces, but stays real-time where it lands, so moving things keep their shadows.
// Units match three's hemisphere light: an open floor under a sky of color c and intensity i gets the irradiance c * i, so the map can replace the light it stands for.
import { WebGPURenderer, Mesh, Group, Box3, Vector3, Color, BufferAttribute, DataUtils } from 'three/webgpu';
import { Fn, Loop, If, attribute, cos, cross, float, fract, normalize, screenCoordinate, select, sin, sqrt, texture, uniform, vec2, vec3 } from 'three/tsl';
import { LightMapper } from 'three/addons/lighting/LightMapper.js';
import { unwrapUVs } from 'three/addons/utils/unwrapUVs.js';
import { BVHComputeData, rayIntersectionResultStruct, rayStruct, wgslTagFn } from 'three-mesh-bvh/webgpu';

const RAYS = 8;      // rays per texel in one mapper sample: LightMapper accumulates at most 256 samples, and more rays in one draw risk the driver's watchdog on a large map
const BOUNCES = 3;   // light passes before the last one: a room lit through one opening is mostly bounced light, one bounce leaves its far corners black
const DARK = 1e-3;   // brightest texel under this: nothing lit the map

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

/** The game's hemisphere and ambient lights as a sky: what a ray that leaves the scene brings, from above and from below the horizon */
function skyOf(scene) {
  const up = new Color(0), down = new Color(0);
  scene.traverseVisible(o => {
    if (o.isHemisphereLight) { up.add(o.color.clone().multiplyScalar(o.intensity)); down.add(o.groundColor.clone().multiplyScalar(o.intensity)); }
    else if (o.isAmbientLight) { const c = o.color.clone().multiplyScalar(o.intensity); up.add(c); down.add(c); }
  });
  return { up, down };
}

const num = x => { const s = String(+x.toFixed(6)); return /[.e]/.test(s) ? s : s + '.0'; };
const v3 = (x, y, z) => `vec3f(${num(x)}, ${num(y)}, ${num(z)})`;

/** One WGSL statement block per sun, point and spot light of the game. Written out rather than looped: a bake compiles once, and each kind has its own falloff */
function lightCode(scene) {
  const out = [], a = new Vector3(), b = new Vector3();
  scene.traverseVisible(o => {
    if (!(o.isDirectionalLight || o.isPointLight || o.isSpotLight) || !o.intensity) return;
    const c = o.color.clone().multiplyScalar(o.intensity), color = v3(c.r, c.g, c.b);
    o.getWorldPosition(a);
    if (o.isDirectionalLight) {
      o.target.getWorldPosition(b);
      const d = a.clone().sub(b).normalize();
      out.push(`{ let l = ${v3(d.x, d.y, d.z)}; let k = dot(n, l); if (k > 0.0 && bakeRay(o, l, 0.0).w < 0.0) { sum += ${color} * k; } }`);
      return;
    }
    // three's getDistanceAttenuation, and for a spot the cone smoothstep
    const cut = o.distance > 0 ? `* pow(saturate(1.0 - pow(dist / ${num(o.distance)}, 4.0)), 2.0)` : '';
    let cone = '';
    if (o.isSpotLight) {
      o.target.getWorldPosition(b);
      const d = a.clone().sub(b).normalize(), outer = Math.cos(o.angle), inner = Math.cos(o.angle * (1 - o.penumbra));
      cone = `* smoothstep(${num(outer)}, ${num(Math.max(inner, outer + 1e-4))}, dot(l, ${v3(d.x, d.y, d.z)}))`;
    }
    out.push(`{ let to = ${v3(a.x, a.y, a.z)} - o; let dist = length(to); let l = to / dist; let k = dot(n, l);
      if (k > 0.0 && bakeRay(o, l, dist).w < 0.0) { sum += ${color} * k / max(pow(dist, ${num(o.decay)}), 0.01) ${cut} ${cone}; } }`);
  });
  return out.join('\n');
}

/**
 * The game's color per vertex: a bounce needs the color of the surface it leaves. Written as vertex attributes because the bake's meshes share one material.
 * shortcut: material.color and emissive only, a texture's own color does not tint the bounce; upgrade if a strongly colored texture on a white material looks wrong.
 */
function paint(geometry, material) {
  const n = geometry.attributes.position.count, albedo = new Float32Array(n * 3), glow = new Float32Array(n * 3), list = [].concat(material);
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: geometry.index ? geometry.index.count : n, materialIndex: 0 }];
  for (const g of groups) {
    const m = list[g.materialIndex ?? 0] ?? list[0], c = m.color ?? new Color(1, 1, 1), e = (m.emissive ?? new Color(0)).clone().multiplyScalar(m.emissiveIntensity ?? 1);
    for (let i = g.start; i < g.start + g.count; i++) {
      const v = geometry.index ? geometry.index.getX(i) : i;
      albedo.set([c.r, c.g, c.b], v * 3); glow.set([e.r, e.g, e.b], v * 3);
    }
  }
  geometry.setAttribute('bakeAlbedo', new BufferAttribute(albedo, 3));
  geometry.setAttribute('bakeGlow', new BufferAttribute(glow, 3));
}

/** @param {{ size: number, samples: number }} opts samples: rays per texel */
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

  // unwrap copies: unwrapUVs replaces a mesh's geometry, and the game's meshes must stay as they are
  const root = new Group(), box = new Box3();
  const copies = meshes.map(o => { box.expandByObject(o); const p = new Mesh(o.geometry, o.material); p.name = o.name; o.matrixWorld.decompose(p.position, p.quaternion, p.scale); return p; });
  root.add(...copies);
  const atlas = unwrapUVs(root, { resolution: opts.size, padding: 4 });
  if (!atlas) return { error: `the meshes do not fit a ${opts.size} atlas: raise --size` };
  root.updateMatrixWorld(true);
  for (const c of copies) paint(c.geometry, c.material);

  const bvh = new BVHComputeData(copies, { attributes: { position: 'vec4f', uv1: 'vec2f' } });
  bvh.update();
  const { attributes } = bvh.storage;
  // w: -1 the ray left the scene, 0 it hit a back face (inside a solid, nothing to bring), 1 it hit a front face; xy: the lightmap position of the hit
  const bakeRay = wgslTagFn/* wgsl */`
    fn bakeRay(origin: vec3f, dir: vec3f, maxDist: f32) -> vec4f {
      var ray: ${rayStruct};
      ray.origin = origin; ray.direction = dir; ray.maxDist = maxDist;
      var hit: ${rayIntersectionResultStruct};
      ${bvh.fns.raycastFirstHit}(ray, &hit);
      if (!hit.didHit) { return vec4f(0.0, 0.0, 0.0, -1.0); }
      if (hit.side < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
      let b = hit.barycoord;
      let uv = ${attributes}[hit.indices.x].uv1 * b.x + ${attributes}[hit.indices.y].uv1 * b.y + ${attributes}[hit.indices.z].uv1 * b.z;
      return vec4f(uv, hit.dist, 1.0);
    }`;
  const code = lightCode(e.scene);
  const bakeDirect = wgslTagFn/* wgsl */`
    fn bakeDirect(o: vec3f, n: vec3f) -> vec3f {
      var sum = vec3f(0.0);
      ${[bakeRay]}
      ${code}
      return sum;
    }`;

  // Two mappers in turn, each reading what the other wrote: a surface's map cannot be read while it is written
  const { up, down } = skyOf(e.scene), span = box.getSize(new Vector3()).length(), bias = Math.max(span * 1e-4, 1e-3);
  const skyUp = vec3(up.r, up.g, up.b), skyDown = vec3(down.r, down.g, down.b), last = uniform(0);
  const makeMapper = readFrom => new LightMapper(r, opts.size, (p, n, sample) => Fn(() => {
    const o = p.add(n.mul(bias)).toVar(), sum = vec3(0).toVar();
    const t = normalize(cross(n, select(n.y.abs().lessThan(0.9), vec3(0, 1, 0), vec3(1, 0, 0)))).toVar(), b = cross(n, t).toVar();
    // a low-discrepancy sequence, shifted per texel: neighbours then differ by fine noise instead of sharing the same bands
    const shift = fract(screenCoordinate.xy.dot(vec2(0.06711056, 0.00583715)).mul(52.9829189)).toVar();
    Loop(RAYS, ({ i }) => {
      const k = sample.mul(RAYS).add(float(i)).add(1);
      const u = fract(k.mul(0.7548776662).add(shift)), v = fract(k.mul(0.5698402910).add(shift.mul(1.618)));
      const rad = sqrt(u), phi = v.mul(Math.PI * 2);   // cosine-weighted: the plain mean of what the rays bring is then the irradiance
      const dir = normalize(t.mul(rad.mul(cos(phi))).add(b.mul(rad.mul(sin(phi)))).add(n.mul(sqrt(float(1).sub(u))))).toVar();
      const hit = bakeRay({ origin: o, dir, maxDist: float(0) }).toVar();
      If(hit.w.lessThan(0), () => { sum.addAssign(select(dir.y.greaterThan(0), skyUp, skyDown)); })
        .ElseIf(hit.w.greaterThan(0), () => { sum.addAssign(texture(readFrom(), hit.xy).level(0).rgb); });
    });
    const gathered = sum.div(RAYS).toVar(), result = gathered.toVar();
    // the passes before the last hand on what a surface sends out; the last one is the map itself: irradiance, without the surface's color and without direct light
    If(last.lessThan(0.5), () => { result.assign(gathered.add(bakeDirect({ o, n })).mul(attribute('bakeAlbedo', 'vec3')).add(attribute('bakeGlow', 'vec3').mul(Math.PI))); });
    return result;
  })());
  const mapperA = makeMapper(() => mapperB.texture), mapperB = makeMapper(() => mapperA.texture);
  for (const m of [mapperA, mapperB]) {
    m.addObjects(copies);
    r.setRenderTarget(m._renderTarget); r.setClearColor(0, 0); r.clear();   // the first pass reads a map nobody wrote yet: black, so its rays bring sky only
  }
  r.setRenderTarget(null);
  // rays per texel: a mapper sample holds RAYS of them; the passes before the last feed a blur of many rays, so they need fewer
  const samples = Math.ceil(opts.samples / RAYS), passes = [mapperA, mapperB, mapperA], final = mapperB;
  for (const m of passes.slice(0, BOUNCES)) { m.reset(); m.update(Math.ceil(samples / 2)); }
  last.value = 1; final.reset(); final.update(samples);

  // shortcut: reads mapper._renderTarget, three gives no public way to the target; a three.js update that renames it stops this bake with a clear TypeError
  const px = await r.readRenderTargetPixelsAsync(final._renderTarget, 0, 0, opts.size, opts.size);
  const row = px.length / opts.size, tex = new Uint16Array(opts.size * opts.size * 4);
  for (let y = 0; y < opts.size; y++) tex.set(px.subarray(y * row, y * row + opts.size * 4), y * opts.size * 4);
  let brightest = 0;
  for (let i = 0; i < tex.length; i += 4) for (let c = 0; c < 3; c++) if (tex[i + c] < 0x7c00 && tex[i + c] > brightest) brightest = tex[i + c];   // positive halves order like their bits; 0x7c00 up: inf and NaN
  brightest = DataUtils.fromHalfFloat(brightest);
  // an all-black file would load without a word and turn the next run of the game black: this is a failed bake, not a result
  if (brightest < DARK) return { error: 'the bake saw no light, so nothing was written: the game\'s hemisphere and ambient lights are at 0 and no sun, lamp or glowing material reached a static surface. If the game turns them off once a lightmap loads, bake through a URL that keeps them on: threedog bake light --page "/?bake=1" (recipes/34-environment-lighting.md)', backend, gpu };

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
  const out = { meta, texture: toBase64(new Uint8Array(tex.buffer)), lists: toBase64(lists), backend, gpu, ms: Math.round(performance.now() - t0), warnings: atlas.warnings, rays: samples * RAYS, brightest };
  mapperA.dispose(); mapperB.dispose(); bvh.dispose(); r.dispose();
  return out;
};
window.threedogBakeLightReady = true;
