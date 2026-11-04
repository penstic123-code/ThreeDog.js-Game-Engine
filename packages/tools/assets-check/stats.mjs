// Model statistics for the build report: meshes, materials, textures (transfer size vs GPU memory), animations.
const KB = n => (n / 1024).toFixed(1) + ' KB', MB = n => (n / 1048576).toFixed(1) + ' MB';
export { KB, MB };

const FORMAT = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP', 'image/ktx2': 'KTX2' };

/** @param {any} doc glTF Transform Document @param {any} core @gltf-transform/core */
export function modelStats(doc, core) {
  const root = doc.getRoot();
  let primitives = 0, vertices = 0, triangles = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    primitives++;
    const pos = p.getAttribute('POSITION')?.getCount() ?? 0;
    vertices += pos; triangles += Math.round((p.getIndices()?.getCount() ?? pos) / 3);
  }
  // Transfer = bytes in the file. GPU = what the card holds: WebP / PNG / JPEG are decoded to RGBA8 (4 bytes per pixel, +1/3 for mips); KTX2 stays
  // block-compressed on the GPU, ~1 byte per pixel (+1/3). This is an estimate: the real KTX2 target format depends on the device.
  const textures = root.listTextures().map(t => {
    const size = core.ImageUtils.getSize(t.getImage(), t.getMimeType()), mime = t.getMimeType(), px = size ? size[0] * size[1] : 0;
    return { name: t.getName() || t.getURI() || '', format: FORMAT[mime] || mime, width: size?.[0], height: size?.[1], transferBytes: t.getImage()?.byteLength ?? 0, gpuBytes: Math.round(px * (mime === 'image/ktx2' ? 1 : 4) * 4 / 3) };
  });
  const anims = root.listAnimations();
  return {
    nodes: root.listNodes().length, meshes: root.listMeshes().length, primitives, vertices, triangles, skins: root.listSkins().length,
    materials: root.listMaterials().length,
    textures: { count: textures.length, formats: [...new Set(textures.map(t => t.format))], transferBytes: textures.reduce((s, t) => s + t.transferBytes, 0), gpuBytes: textures.reduce((s, t) => s + t.gpuBytes, 0), list: textures },
    animations: { count: anims.length, channels: anims.reduce((s, a) => s + a.listChannels().length, 0),
      seconds: +Math.max(0, ...anims.flatMap(a => a.listSamplers().map(s => s.getInput()?.getMax([])[0] ?? 0))).toFixed(2) },
  };
}

/** Lines for the console */
export function statsLines(s, indent = '    ') {
  const t = s.textures, fmt = t.formats.join('+') || 'none';
  return [
    `${indent}geometry   ${s.meshes} meshes (${s.primitives} primitives), ${s.vertices} vertices, ${s.triangles} triangles, ${s.skins} skins`,
    `${indent}materials  ${s.materials}`,
    `${indent}textures   ${t.count} × ${fmt}: transfer ${KB(t.transferBytes)} (download size) · GPU ≈ ${MB(t.gpuBytes)} (memory on the card, estimate)`,
    `${indent}animation  ${s.animations.count} clips, ${s.animations.channels} channels, longest ${s.animations.seconds} s`,
  ];
}
