// Written as if pasted from a snippet: a closure factory, everything local, cleanup as one tracked handle. Holds the fog, and dims the sun through the shared value.
import * as THREE from 'three';

export const rain = ({ count = 200 } = {}) => ({
  name: 'rain', type: 'picture', requires: ['sun'], provides: ['fog'],
  install(e, ctx) {
    const positions = new Float32Array(count * 3).map(() => (Math.random() - 0.5) * 40);
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const drops = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.1, transparent: true, opacity: 0, color: 0x99aabb }));
    drops.name = 'rainDrops';
    e.scene.add(drops);
    e.scene.fog = new THREE.Fog(0x667788, 10, 200);
    ctx.mod('sun.level', { mul: 0.7 });
    ctx.track(e.onRender(() => {
      const wet = e.uniforms.uRain.value;
      drops.material.opacity = wet;
      e.scene.fog.far = 200 - 120 * wet;
    }));
    // the holder's own listener: no frame hook is running, so only the file says whose write this is
    ctx.track(e.events.on('rain:flash', () => { e.scene.fog.near = 2; }));
    ctx.track({ remove() { e.scene.remove(drops); e.scene.fog = null; geometry.dispose(); drops.material.dispose(); } });
    return { drops };
  },
});
