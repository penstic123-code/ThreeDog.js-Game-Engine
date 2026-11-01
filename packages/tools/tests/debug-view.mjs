// Diagnostic view modes (core/debugView.js) and overrides (core/DebugOverrides.js) on a three scene in node: each mode changes the drawing, 'off' restores
// every material and light, owners are respected, and views and overrides share one chain (a view and an override on the same mesh never restore each
// other's stale material, nothing disposes the real material, a throwing apply leaves nothing behind).
import * as THREE from 'three';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { DebugOverrides } = await import(pathToFileURL(join(ENGINE, 'core/DebugOverrides.js')).href);

export const name = 'debug view: albedo / lighting / shadow / normals are temporary, owned, and share one override chain with debug.override';

export async function run({ check }) {
  const scene = new THREE.Scene(), mat = new THREE.MeshStandardMaterial({ color: 0x336699 });
  let disposed = 0; mat.addEventListener('dispose', () => disposed++);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat), amb = new THREE.AmbientLight(), hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  scene.add(mesh, amb, hemi, sun);
  const d = new DebugOverrides({ scene, THREE, thing: () => ({ object: mesh }), _things: { entryOf: () => null, live: () => mesh } });
  const v = { set: (m, o) => d.view(m, o), state: () => d.viewState() };
  v.set('albedo');
  check('albedo draws the base color unlit', mesh.material.isMeshBasicMaterial && mesh.material.color.getHex() === 0x336699);
  v.set('lighting');
  check('switching restores the albedo swap, lighting uses a white override', mesh.material === mat && scene.overrideMaterial?.isMeshStandardMaterial);
  v.set('shadow');
  check('shadow hides ambient and hemisphere lights only', !amb.visible && !hemi.visible && sun.visible);
  v.set('normals');
  check('normals restores the lights', amb.visible && hemi.visible && scene.overrideMaterial?.isMeshNormalMaterial);
  check('state says which view is on and what it means', v.state().mode === 'normals' && /normal/.test(v.state().what));
  v.set('off', { owner: 'someone else' });
  check('another owner cannot clear it without force', v.state().mode === 'normals');
  check('another owner cannot switch it either (the note says who holds it)', v.set('albedo', { owner: 'someone else' }).note && v.state().mode === 'normals');
  v.set('off');
  check('off restores the real look', v.state().mode === 'off' && !scene.overrideMaterial && mesh.material === mat);
  v.set('albedo', { owner: 'a' }); v.set('off', { owner: 'b', force: true });
  check('force clears another owner\'s view', v.state().mode === 'off' && mesh.material === mat);

  // one chain: view + override on the same mesh, removed in either order, always ends on the real material, never disposed
  v.set('albedo', { owner: 'a' });
  const h = d.override('probe', 'm', { material: 'wire' });
  check('an override on top of the albedo view derives from the real material (no stacked copies)', mesh.material.wireframe && mesh.material.userData._dbgOf === mat);
  v.set('off', { owner: 'a' });
  check('turning the view off keeps the newer override', mesh.material.wireframe);
  h.remove();
  check('removing the override returns the real material, which was never disposed', mesh.material === mat && disposed === 0);
  const h2 = d.override('probe', 'm', { material: 'flat' }); v.set('albedo', { owner: 'a' }); h2.remove(); v.set('off', { owner: 'a' });
  check('the other order ends on the real material too', mesh.material === mat && disposed === 0);

  // clear(owner) also turns off that owner's view (review M10)
  v.set('lighting', { owner: 'tool' }); d.override('tool', 'm', { visible: false });
  const n = d.clear('tool');
  check('clear(owner) removes its overrides and its view', n === 2 && v.state().mode === 'off' && !scene.overrideMaterial && mesh.visible);

  // all-or-nothing apply (review M13): a throwing step undoes the earlier ones and nothing is listed
  let threw = false;
  try { d.override('bad', 'm', { visible: false, apply: () => { throw new Error('boom'); } }); } catch { threw = true; }
  check('an apply that throws leaves the object as it was and adds no override', threw && mesh.visible && d.overrides().length === 0);

  // keyed by id: a removed thing's override is dropped (review M5)
  d.override('probe', 'm', { visible: false }); scene.remove(mesh);
  check('removing the thing drops its override and undoes it', d.overrides().length === 0 && mesh.visible);
}
