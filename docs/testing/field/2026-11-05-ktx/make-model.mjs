// Builds the test model: a brick-covered UV sphere with a color map (2048), a normal map (2048, from the same brick height field) and a
// metallicRoughness map (1024), all real PNG pixels. Usage: node make-model.mjs <out.glb>   (run from the repo root so @gltf-transform/core and sharp resolve)
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req = createRequire(resolve(process.cwd(), 'package.json')), core = req('@gltf-transform/core'), sharp = req('sharp');
const out = process.argv[2];
const N = 2048, ROWS = 16, COLS = 8;   // texture size, brick rows and columns per tile
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
// brick height field: 1 on a brick, 0 on mortar, soft edge, per-brick random tint
const tint = new Float32Array(ROWS * (COLS + 1)).map(() => rnd());
const heightAt = (x, y) => {
  const row = Math.floor(y / N * ROWS), off = (row % 2) * 0.5, u = ((x / N * COLS + off) % 1 + 1) % 1, v = (y / N * ROWS) % 1;
  const edge = Math.min(u, 1 - u, v, 1 - v), brick = Math.floor(x / N * COLS + off);
  return { h: Math.min(1, edge / 0.06), id: row * (COLS + 1) + (((brick % COLS) + COLS) % COLS) };
};
const H = new Float32Array(N * N), ID = new Int32Array(N * N);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const r = heightAt(x, y); H[y * N + x] = r.h * (0.85 + 0.15 * rnd()); ID[y * N + x] = r.id; }
const color = Buffer.alloc(N * N * 3), normal = Buffer.alloc(N * N * 3), orm = Buffer.alloc(1024 * 1024 * 3);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = y * N + x, t = tint[ID[i]], mortar = H[i] < 0.5;
  const grain = 0.9 + 0.2 * rnd(), base = mortar ? [170, 165, 155] : [150 + 60 * t, 70 + 30 * t, 50 + 20 * t];
  color.set(base.map(c => Math.max(0, Math.min(255, c * grain))), i * 3);
  const dx = (H[y * N + Math.min(N - 1, x + 1)] - H[y * N + Math.max(0, x - 1)]) * 6, dy = (H[Math.min(N - 1, y + 1) * N + x] - H[Math.max(0, y - 1) * N + x]) * 6;
  const l = Math.hypot(dx, dy, 1);
  normal.set([(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255], i * 3);   // glTF: +Y up in texture space, image rows grow downward
}
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) { const h = H[(y * 2) * N + x * 2]; orm.set([255, h < 0.5 ? 255 : 200 + 40 * rnd(), 0], (y * 1024 + x) * 3); }   // G roughness, B metal
const png = (b, n) => sharp(b, { raw: { width: n, height: n, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
const doc = new core.Document(), buf = doc.createBuffer();
const tex = async (n, b, size) => doc.createTexture(n).setImage(new Uint8Array(await png(b, size))).setMimeType('image/png');
const mat = doc.createMaterial('brick_mat').setBaseColorTexture(await tex('brick_albedo', color, N)).setNormalTexture(await tex('brick_normal', normal, N))
  .setMetallicRoughnessTexture(await tex('brick_orm', orm, 1024)).setRoughnessFactor(1).setMetallicFactor(1);
// UV sphere, 64 x 32, texture repeated 3 times around and 2 times pole to pole
const SEG = 64, RING = 32, pos = [], uv = [], idx = [];
for (let r = 0; r <= RING; r++) for (let s = 0; s <= SEG; s++) {
  const th = r / RING * Math.PI, ph = s / SEG * Math.PI * 2;
  pos.push(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)); uv.push(s / SEG * 3, r / RING * 2);
}
for (let r = 0; r < RING; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
const acc = (t, a) => doc.createAccessor().setType(t).setArray(a).setBuffer(buf);
const nrm = pos.slice();   // unit sphere: normal = position
const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', new Float32Array(pos))).setAttribute('NORMAL', acc('VEC3', new Float32Array(nrm)))
  .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(uv))).setIndices(acc('SCALAR', new Uint32Array(idx))).setMaterial(mat);
doc.createScene().addChild(doc.createNode('brickball').setMesh(doc.createMesh('brickball').addPrimitive(prim)));
await new core.NodeIO().write(out, doc);
