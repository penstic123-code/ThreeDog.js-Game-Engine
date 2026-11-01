// Minimal skinned glTF built in code (no downloaded file): a body and an arm with a hand bone, exported to GLB by three's GLTFExporter.
// Why export instead of handing the Object3D over: the test then goes through the real import path (download, GLTFLoader, SkeletonUtils clone,
// clips in userData.animations), the same as a file from Blender. Clips are named the way Blender exports them ('Armature|Idle'),
// and there are both Idle and Idle_Armed, so a mapping that picks Idle_Armed proves the character's default 'Idle' does not shadow it.
//   Slash (1 s): the arm is straight up at 0.3 s and swung down by 0.6 s; the hand bone's world height shows where the swing is.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One box weighted fully to one bone */
function part(w, h, d, y, bone) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, y, 0), n = g.attributes.position.count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n).fill(0).flatMap(() => [bone, 0, 0, 0]), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [1, 0, 0, 0]), 4));
  return g;
}

/** GLB bytes (ArrayBuffer) of the dummy and its clips */
export async function skinnedGlb() {
  const [hips, arm, hand] = ['Hips', 'Arm', 'Hand'].map(n => Object.assign(new THREE.Bone(), { name: n }));
  arm.position.set(0.4, 1.4, 0); hand.position.set(0, 0.8, 0);
  hips.add(arm); arm.add(hand);
  // the arm box hangs from the shoulder upward (0 -> 0.8 in arm space): skin space equals bind space, so place it at the shoulder height
  const armGeo = part(0.15, 0.8, 0.15, 0.4, 1).translate(0.4, 1.4, 0);
  const geo = mergeGeometries([part(0.6, 1.6, 0.4, 0.8, 0), armGeo]);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x999999 }));
  const scene = new THREE.Group(); scene.name = 'Armature'; scene.add(mesh);
  mesh.name = 'Dummy'; mesh.add(hips);
  scene.updateMatrixWorld(true);   // bind() computes the inverse bind matrices from the bones' current world matrices
  mesh.bind(new THREE.Skeleton([hips, arm, hand]));

  const q = x => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), x).toArray();
  const swing = (name, times, angles) => new THREE.AnimationClip('Armature|' + name, times[times.length - 1],
    [new THREE.QuaternionKeyframeTrack('Arm.quaternion', times, angles.flatMap(q))]);
  const clips = [
    swing('Idle', [0, 1, 2], [0, 0.05, 0]),
    swing('Idle_Armed', [0, 1, 2], [0.2, 0.25, 0.2]),
    swing('Walk', [0, 0.5, 1], [-0.5, 0.5, -0.5]),
    swing('Slash', [0, 0.3, 0.6, 1], [0.8, 0, 2.2, 1.6]),   // hand height = 1.4 + 0.8 cos(angle): straight up (top) at 0.3, swung down by 0.6
    swing('Hit', [0, 0.2, 0.5], [0, -1, 0]),
  ];
  return new GLTFExporter().parseAsync(scene, { binary: true, animations: clips });
}
