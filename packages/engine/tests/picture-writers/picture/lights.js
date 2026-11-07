import * as THREE from 'three';
export function createLights(engine) {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = 'sun';
  engine.scene.add(sun);
  let t = 0;
  return { sun, update() {
    t += 0.01;
    sun.intensity = 1 + Math.sin(t);                     // every frame: one writer
    sun.color.setRGB(1, 0.5 + 0.5 * Math.sin(t), 0.5);   // in place
    sun.position.set(Math.cos(t), 2, Math.sin(t));       // in place
    if (window.mode === 'duel' && window.tick % 2 === 0) window.game.speed = 1;   // rival.js writes it on the other frames: a fight that never shares one
  } };
}
