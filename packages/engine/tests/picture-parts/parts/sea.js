// Written as if by a third author who knows the module hooks: a plain object, a frame hook instead of onRender, cleanup in dispose, no slot at all: only more things.
// A surface, a lamp on a buoy and a post effect are all additions, so nothing here can collide.
import * as THREE from 'three';

export function sea() {
  let water, buoy, grade;
  return {
    name: 'sea', type: 'picture', stage: 'effects',
    install(e) {
      water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x224466, roughness: 0.2 }));
      water.name = 'seaSurface';
      water.rotation.x = -Math.PI / 2;
      buoy = new THREE.PointLight(0xffaa66, 1, 20);
      buoy.name = 'buoy';
      e.scene.add(water, buoy);
      grade = e.post.add({ name: 'seaGrade', fuse: { glsl: 'color.rgb *= 0.98;' }, slot: 'ldr' });
      return { get water() { return water; }, get buoy() { return buoy; } };
    },
    frame(_dt, e) {
      water.material.roughness = 0.2 + 0.6 * e.uniforms.uRain.value;
      buoy.intensity = 3 * (1 - e.uniforms.uDaylight.value);
    },
    dispose(e) {
      e.scene.remove(water, buoy);
      water.geometry.dispose();
      water.material.dispose();
      buoy.dispose();
      grade.remove();
    },
  };
}
