// Material and color-space review of a glb. Reports suspicions only, never edits the file.
// Basis: the glTF spec fixes the color space by slot (baseColor and emissive textures are sRGB, normal / occlusion / metallicRoughness are linear data), and
// three's color management manual says the same: color textures get SRGBColorSpace, data textures stay NoColorSpace. A file cannot carry a "sRGB flag"
// that differs from the slot, so "mis-marked" means: the texture's name or file says it is data but a color slot uses it, or the reverse, or one texture
// sits in both kinds of slot (it can only have one color space).
const COLOR_HINT = /(albedo|base_?colou?r|diffuse|_col(or)?\b|emissi)/i;
const DATA_HINT = /(normal|_nrm\b|_nor\b|rough|metal|_orm\b|_mr\b|_ao\b|occlusion|height|bump)/i;
const FOLIAGE = /(leaf|leaves|grass|plant|fence|tree|bush|vine|flower|hair|lattice|wire)/i;
const SIZE_WARN = 2048, SIZE_BIG = 4096;

/**
 * @param {any} doc glTF Transform Document @param {any} core the @gltf-transform/core module (ImageUtils)
 * @returns {{ severity: 'warn' | 'info', code: string, where: string, msg: string }[]}
 */
export function reviewMaterials(doc, core) {
  const out = [], add = (severity, code, where, msg) => out.push({ severity, code, where, msg });
  const root = doc.getRoot(), hint = t => `${t.getName() || ''} ${t.getURI() || ''}`;
  for (const mat of root.listMaterials()) {
    const where = `material ${mat.getName() || '(unnamed)'}`;
    const color = { baseColor: mat.getBaseColorTexture(), emissive: mat.getEmissiveTexture() };
    const data = { normal: mat.getNormalTexture(), occlusion: mat.getOcclusionTexture(), metallicRoughness: mat.getMetallicRoughnessTexture() };
    for (const [slot, t] of Object.entries(color)) if (t && DATA_HINT.test(hint(t)) && !COLOR_HINT.test(hint(t))) add('warn', 'data-in-color-slot', where,
      `texture "${t.getName() || t.getURI()}" looks like data (name says ${DATA_HINT.exec(hint(t))[0]}) but is used as ${slot}, so it is read as sRGB and shaded wrongly. Move it to the data slot, or rename it if it really is color.`);
    for (const [slot, t] of Object.entries(data)) if (t && COLOR_HINT.test(hint(t)) && !DATA_HINT.test(hint(t))) add('warn', 'color-in-data-slot', where,
      `texture "${t.getName() || t.getURI()}" looks like color but is used as ${slot}, which is read as linear data, so it will look wrong. Check the slot in Blender, or rename it if it really is data.`);
    for (const [cs, ct] of Object.entries(color)) for (const [ds, dt] of Object.entries(data)) if (ct && ct === dt) add('warn', 'shared-color-and-data', where,
      `one texture is used as both ${cs} (sRGB) and ${ds} (linear data); a texture has a single color space, so one of the two reads wrong. Use separate images.`);
    if (mat.getEmissiveTexture() && mat.getEmissiveFactor().every(v => v === 0)) add('warn', 'emissive-hidden', where,
      'has an emissive texture but emissiveFactor is black, so it never glows (glTF multiplies them). Set the emissive color to white in Blender.');
    if (mat.getAlphaMode() === 'BLEND') {
      const a = mat.getBaseColorFactor()[3], tex = mat.getBaseColorTexture();
      if (a >= 1 && !tex) add('warn', 'blend-opaque', where, 'alpha mode BLEND but the color is fully opaque and has no texture: use OPAQUE (BLEND costs sorting and overdraw for nothing).');
      else add('info', 'blend', where, FOLIAGE.test(mat.getName() || '') ?
        'alpha mode BLEND on what looks like a cutout (leaves, fence, hair): MASK with an alpha cutoff is cheaper, writes depth and avoids sorting glitches.' :
        'alpha mode BLEND sorts per object and does not write depth; if the edge is hard (cutout) use MASK, keep BLEND for real translucency (glass, fade).');
    }
  }
  // Textures: UV presence per mesh primitive, size
  const matUsesTex = m => [m.getBaseColorTexture(), m.getEmissiveTexture(), m.getNormalTexture(), m.getOcclusionTexture(), m.getMetallicRoughnessTexture()].some(Boolean);
  const bad = new Set();
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial();
    if (!m || !matUsesTex(m)) continue;
    const slots = [[m.getBaseColorTexture(), m.getBaseColorTextureInfo()], [m.getEmissiveTexture(), m.getEmissiveTextureInfo()], [m.getNormalTexture(), m.getNormalTextureInfo()],
      [m.getOcclusionTexture(), m.getOcclusionTextureInfo()], [m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo()]];
    for (const [t, info] of slots) if (t && !p.getAttribute('TEXCOORD_' + info.getTexCoord())) bad.add(`${mesh.getName() || '(unnamed mesh)'}|${m.getName()}`);
  }
  for (const k of bad) { const [mesh, mat] = k.split('|'); add('warn', 'texture-without-uv', `mesh ${mesh}`,
    `material ${mat || '(unnamed)'} has a texture but this mesh has no matching UV set, so the texture shows one flat pixel. Unwrap it in Blender (UV Editing) and export again.`); }
  for (const t of root.listTextures()) {
    const size = core.ImageUtils.getSize(t.getImage(), t.getMimeType());
    if (!size) continue;
    const big = Math.max(...size), label = t.getName() || t.getURI() || '(unnamed texture)';
    if (big > SIZE_WARN) add('warn', 'big-texture', `texture ${label}`, `${size[0]}x${size[1]} is large for a ${big > SIZE_BIG ? 'web game (over 4096)' : 'low-poly web game'}: it costs ~${(size[0] * size[1] * 4 * 4 / 3 / 1048576).toFixed(0)} MB of GPU memory uncompressed. Downscale to ${SIZE_WARN} or less, or ship KTX2.`);
  }
  return out;
}
