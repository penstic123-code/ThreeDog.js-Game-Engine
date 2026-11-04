// City block built in code (can be baked to public/models/baked/city-block.glb with npm run bake; may later be replaced by a Blender-exported glTF).
import { THREE } from '../../index.js';
import { neutralMaterial } from '../../render/neutral.js';
import data from './content/index.js';

// ---------- Build a block in code (later replaced by a Blender-exported glTF) ----------
export function buildBlock() {
  const root = new THREE.Group();
  const mat = neutralMaterial('building', { color: 0xc8c4bc });   // neutral default material, color passed through
  const ground = new THREE.Mesh(new THREE.BoxGeometry(160, 1, 160), neutralMaterial('ground', { color: 0x9a9a96 }));
  ground.name = 'ground'; ground.position.y = -0.5; root.add(ground);
  // A platform in the middle of the plaza that can be walked onto + a ramp
  const stage = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), neutralMaterial('ground', { color: 0xb0aca4 }));
  stage.name = 'floor_stage'; stage.position.set(0, 0.6, -14); root.add(stage);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 6), stage.material);
  ramp.name = 'ramp'; ramp.position.set(0, 0.55, -7.2); ramp.rotation.x = Math.atan2(1.2, 6); root.add(ramp);
  // Buildings: boxes named col_* are colliders (hidden); the building itself is only visuals
  for (let gx = -3; gx <= 3; gx++) for (let gz = -3; gz <= 3; gz++) {
    if (gx === 0 && (gz === 0 || gz === -1)) continue;
    const w = 8 + ((gx * 7 + gz * 13) & 3) * 2, h = 6 + ((gx * 5 + gz * 3) & 7) * 3, x = gx * 22, z = gz * 22;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    b.name = `building_${gx}_${gz}`; b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; root.add(b);
    const col = new THREE.Mesh(new THREE.BoxGeometry(w, h, w)); col.name = `col_${gx}_${gz}`; col.position.copy(b.position); root.add(col);
  }
  // Marker points (spawn, NPCs, trigger zones) come from content/level.js
  for (const [name, { x, z, ...extra }] of Object.entries(data.level.markers)) {
    const o = new THREE.Object3D(); o.name = name; o.position.set(x, 0, z); Object.assign(o.userData, extra); root.add(o);
  }
  return root;
}
