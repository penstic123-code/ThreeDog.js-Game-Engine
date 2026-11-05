// Import report of a loaded glTF (engine.assets.report): what the file declares vs what is in the scene now.
// Pure: reads a three.js scene plus the file's JSON (gltf.parser.json), never changes anything, so it also runs in node tests.
// "Lost" means: the file has it, the scene does not (a normal map a material no longer has, a clip that did not load, a material replaced by another).
// Color-space basis: three's color management manual. Color slots (map, emissiveMap) hold sRGB, data slots (normal, roughness, metalness, ao...) stay linear.
import * as THREE from 'three';

// The one slot table: engine.assets.report and engine.inspect.materials judge a texture by it. A lightMap holds light, not a color or a value: a linear bake and an sRGB
// picture are both right, so it is in neither list
export const COLOR_SLOTS = ['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap'];
export const DATA_SLOTS = ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'alphaMap', 'displacementMap', 'specularMap', 'specularIntensityMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'sheenRoughnessMap'];
const SRGB = THREE.SRGBColorSpace, LINEAR = THREE.NoColorSpace;
// three's PropertyBinding.sanitizeNodeName: the name the engine sees ("door.001" -> "door001")
const sanitize = n => String(n ?? '').replace(/\s/g, '_').replace(/[[\].:/]/g, '');

/** Color-space problems of one texture used in the given slots: [] when fine */
function colorSpaceIssues(tex, slots) {
  const out = [], cs = tex.colorSpace || LINEAR;
  const color = slots.filter(s => COLOR_SLOTS.includes(s)), data = slots.filter(s => DATA_SLOTS.includes(s));
  if (color.length && data.length) out.push(`used as both color (${color}) and data (${data}): one texture has one color space`);
  else if (color.length && cs !== SRGB) out.push(`color texture (${slots}) is "${cs || 'none'}", should be srgb (it looks washed out or too dark); set texture.colorSpace = THREE.SRGBColorSpace, or fetch it with engine.assets.texture() (sRGB by default)`);
  else if (data.length && cs === SRGB) out.push(`data texture (${slots}) is srgb, should be linear: the shader would decode it as color. Fetch it with { color: false }`);
  return out;
}

/**
 * @param {{ scene: any, animations?: any[], parser?: any }} gltf a GLTFLoader result (or an object with the same fields)
 * @param {{ name?: string, url?: string, opts?: any }} [entry] asset entry (opts.animation.states is the clip mapping)
 * @param {any} [root] a model copy to check instead of the template scene (what the game actually shows)
 * @param {{ outputColorSpace?: string }} [renderer]
 */
export function reportGltf(gltf, entry = {}, root = gltf.scene, renderer) {
  const json = gltf.parser?.json ?? null, issues = [], flag = (severity, code, msg) => issues.push({ severity, code, msg });
  const materials = new Set(), textures = new Map(), nodes = [], colliders = [], templates = [];
  root.traverse(o => {
    if (o !== root) nodes.push(o.name);
    if (/^col_/i.test(o.name) || o.userData?.collider != null) colliders.push(o.name);
    if (o.userData?.template != null || o.userData?.id != null) templates.push({ node: o.name, ...(o.userData.template != null && { template: String(o.userData.template) }), ...(o.userData.id != null && { id: o.userData.id }) });
    for (const m of [].concat(o.material || [])) materials.add(m);
  });
  const mats = [...materials].map(m => {
    const maps = {};
    for (const k of [...COLOR_SLOTS, ...DATA_SLOTS, 'lightMap']) if (m[k]?.isTexture) {
      maps[k] = m[k].colorSpace || 'none';   // not LINEAR: NoColorSpace is '', so a correct data map read as absent and every intact normal map was reported lost
      const t = textures.get(m[k]) ?? textures.set(m[k], { name: m[k].name || '(unnamed)', slots: [] }).get(m[k]);
      if (!t.slots.includes(k)) t.slots.push(k);
    }
    return { name: m.name || '(unnamed)', type: m.type, maps, flatShading: !!m.flatShading, vertexColors: !!m.vertexColors, madeByEngine: !!m.userData?.purpose };
  });
  const texList = [...textures].map(([t, v]) => ({ ...v, colorSpace: t.colorSpace || LINEAR, problems: colorSpaceIssues(t, v.slots) }));
  for (const t of texList) for (const p of t.problems) flag('warn', 'color-space', `texture ${t.name}: ${p}`);
  if (renderer?.outputColorSpace && renderer.outputColorSpace !== SRGB) flag('warn', 'output-color-space', `renderer output color space is "${renderer.outputColorSpace}", not srgb: every color on screen is encoded wrongly. Leave renderer.outputColorSpace at its default`);
  const clips = (gltf.animations || []).map(a => ({ name: a.name, seconds: +a.duration.toFixed(2), tracks: a.tracks.length }));
  // Against the file: only possible when the loader kept the JSON (code-built models have none)
  if (json) {
    for (const fm of json.materials || []) {
      const live = mats.find(m => m.name === (fm.name || '(unnamed)'));
      if (!live) { if (fm.name) flag('warn', 'material-replaced', `file material "${fm.name}" is not in the scene: a path replaced it (the painted look is gone)`); continue; }
      if (fm.normalTexture && !live.maps.normalMap) flag('warn', 'normal-map-lost', `material "${live.name}" has a normal map in the file but none in the scene`);
      if (fm.pbrMetallicRoughness?.baseColorTexture && !live.maps.map) flag('warn', 'base-color-lost', `material "${live.name}" has a base color texture in the file but none in the scene`);
      if (fm.pbrMetallicRoughness?.metallicRoughnessTexture && !live.maps.roughnessMap && !live.maps.metalnessMap) flag('warn', 'metal-rough-lost', `material "${live.name}" has a metallic-roughness texture in the file but none in the scene`);
      if (live.flatShading) flag('warn', 'flat-shading', `material "${live.name}" is flat shaded; the file asks for smooth normals`);
      if (live.madeByEngine) flag('warn', 'material-replaced', `material "${live.name}" was made by the engine, not read from the file`);
    }
    for (const a of json.animations || []) if (!clips.some(c => c.name === a.name)) flag('warn', 'clip-lost', `file clip "${a.name}" did not load`);
    const names = new Set(nodes.map(sanitize)), gone = (json.nodes || []).map(n => sanitize(n.name)).filter(n => n && !names.has(n));
    if (root === gltf.scene && gone.length) flag('warn', 'node-lost', `file nodes missing from the scene: ${gone.slice(0, 8).join(', ')}${gone.length > 8 ? ', ...' : ''}`);
  }
  const states = entry.opts?.animation?.states ?? {}, mapped = new Set(Object.values(states).map(s => s?.clip).filter(Boolean));
  for (const [state, s] of Object.entries(states)) if (s?.clip && clips.length && !clips.some(c => c.name === s.clip)) flag('warn', 'clip-unmapped', `state "${state}" maps clip "${s.clip}", which the file does not have (clips: ${clips.map(c => c.name).join(', ') || 'none'})`);
  if (mapped.size) for (const c of clips) if (!mapped.has(c.name)) flag('info', 'clip-unused', `clip "${c.name}" is in the file but no animation state uses it`);
  return {
    name: entry.name ?? null, url: entry.url ?? null, fromFile: !!json,
    counts: { nodes: nodes.length, materials: mats.length, textures: texList.length, normalMaps: mats.filter(m => m.maps.normalMap).length, clips: clips.length, colliders: colliders.length, templates: templates.length },
    materials: mats, textures: texList, clips, colliders, templates, issues,
  };
}
