// Test city block (modeled on packages/engine/examples/city): ground, platform, buildings (visual mesh + hidden col_ collision box), markers.
// Some materials use makeMaterial (with purpose), some are created directly; the bake round trip must restore both unchanged.
import { THREE, makeMaterial } from '../../index.js';

export function buildTestBlock() {
  const root = new THREE.Group(); root.name = 'testBlock';
  const ground = new THREE.Mesh(new THREE.BoxGeometry(120, 1, 120), new THREE.MeshLambertMaterial({ color: 0x9a9a96 }));
  ground.name = 'ground'; ground.position.y = -0.5; ground.receiveShadow = true; root.add(ground);
  const stage = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), makeMaterial('stone', { color: 0xb0aca4 }));
  stage.name = 'floor_stage'; stage.position.set(0, 0.6, -14); root.add(stage);
  const mat = makeMaterial('wall', { color: 0xc8c4bc });
  for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) {
    if (gx === 0 && gz >= -1 && gz <= 0) continue;
    const w = 8, h = 6 + ((gx * 5 + gz * 3) & 7) * 2, x = gx * 22, z = gz * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    b.name = `building_${gx}_${gz}`; b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; root.add(b);
    const col = new THREE.Mesh(new THREE.BoxGeometry(w, h, w)); col.name = `col_${gx}_${gz}`; col.position.copy(b.position); root.add(col);
  }
  for (const [name, x, z, extra] of [['spawn', 0, 8, {}], ['npc_shop', -11, 11, {}], ['trigger_plaza', 0, -14, { shape: 'cylinder', radius: 6 }]]) {
    const o = new THREE.Object3D(); o.name = name; o.position.set(x, 0, z); Object.assign(o.userData, extra); root.add(o);
  }
  return root;
}

/** Deliberately slow-to-generate model (for the auto-cache test): a 200×200-cell ground mesh with noise relief, plus computed normals */
export function buildHeavy(n = 400) {
  const g = new THREE.PlaneGeometry(200, 200, n, n).rotateX(-Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); let h = 0; for (let k = 1; k < 40; k++) h += Math.sin(x * 0.01 * k + k) * Math.cos(z * 0.013 * k) / k; p.setY(i, h * 3); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, makeMaterial('ground', { color: 0x8a8a8a })); m.name = 'heavy_ground';
  return m;
}
