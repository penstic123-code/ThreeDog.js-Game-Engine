// Generate the asset files used by the group A tests (already committed here; rarely needs rerunning)：node packages/engine/tests/fixtures/make.mjs
//   box-meshopt.glb  Meshopt-compressed box (12 triangles)
//   box-draco.glb    the same box, Draco-compressed
//   tex-bc1.ktx2     8×8 BC1-compressed texture (KTX2 container)
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, draco } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { createDefaultContainer, VK_FORMAT_BC1_RGBA_SRGB_BLOCK, write } from 'ktx-parse';
import { writeFileSync } from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;

function box() {
  const doc = new Document(), buf = doc.createBuffer();
  const p = [], idx = [];
  // 4 vertices per face, 6 faces (normals differ, so vertices cannot be shared)
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [axis, s] of faces) {
    const base = p.length / 3, u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const q = [0, 0, 0]; q[axis] = s; q[u] = a; q[v] = b * s; p.push(...q); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf);
  const ind = doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buf);
  const mat = doc.createMaterial('box').setBaseColorFactor([0.6, 0.6, 0.6, 1]);
  const mesh = doc.createMesh('box').addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setIndices(ind).setMaterial(mat));
  doc.createScene().addChild(doc.createNode('box').setMesh(mesh));
  return doc;
}

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'draco3d.encoder': await draco3d.createEncoderModule(),
});
const a = box(); await a.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
writeFileSync(dir + 'box-meshopt.glb', await io.writeBinary(a));
const b = box(); await b.transform(draco());
writeFileSync(dir + 'box-draco.glb', await io.writeBinary(b));

// BC1: 8 bytes per 4×4 block (two RGB565 colors + 2-bit indices); every texel uses color0
const W = 8, H = 8, blocks = (W / 4) * (H / 4), data = new Uint8Array(blocks * 8);
for (let i = 0; i < blocks; i++) { const c = i % 2 ? 0xf800 : 0x07e0; data[i * 8] = c & 255; data[i * 8 + 1] = c >> 8; data[i * 8 + 2] = c & 255; data[i * 8 + 3] = c >> 8; }
const k = createDefaultContainer();
k.vkFormat = VK_FORMAT_BC1_RGBA_SRGB_BLOCK;
k.typeSize = 1; k.pixelWidth = W; k.pixelHeight = H; k.pixelDepth = 0; k.layerCount = 0; k.faceCount = 1; k.levelCount = 1;
k.levels = [{ levelData: data, uncompressedByteLength: data.byteLength }];
k.dataFormatDescriptor[0].colorModel = 128;   // KHR_DF_MODEL_BC1A
k.dataFormatDescriptor[0].transferFunction = 2; // sRGB
k.dataFormatDescriptor[0].texelBlockDimension = [3, 3, 0, 0];
k.dataFormatDescriptor[0].bytesPlane = [8, 0, 0, 0, 0, 0, 0, 0];
k.dataFormatDescriptor[0].samples = [{ bitOffset: 0, bitLength: 63, channelType: 0, samplePosition: [0, 0, 0, 0], sampleLower: 0, sampleUpper: 0xffffffff }];
writeFileSync(dir + 'tex-bc1.ktx2', write(k));
console.log('ok');
