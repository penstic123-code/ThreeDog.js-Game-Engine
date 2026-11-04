// @ts-check
// Materials by name. The wall variants are the point of the page: every scale comes from the shot and the real drawing-buffer height, never by eye.
import { THREE } from 'threedog';
import { scaleForCamera, worldVariation, brushTexture, cavity, edgeWear, jitterInstances } from '../surface.js';
import { BRUSH, CAVITY, CLOSE_UP_SCALE, COLORS, JITTER, NOISE, WEAR } from './palette.js';

/** @param {any} engine @param {{ fov: number, position: number[] }} shot the camera the scales are chosen for */
export function createMaterials(engine, shot) {
  const viewH = engine.renderer.getDrawingBufferSize(new THREE.Vector2()).y || 540;
  const dist = Math.hypot(shot.position[1] - 1.1, shot.position[2]);   // to the walls' fronts
  const noiseScale = scaleForCamera(shot, dist, viewH, NOISE.cellPx), brushScale = scaleForCamera(shot, dist, viewH, BRUSH.cellPx);
  const lambert = () => new THREE.MeshLambertMaterial({ color: COLORS.wall });
  /** @type {Record<string, (g: THREE.BoxGeometry, occluders: THREE.BufferGeometry[]) => THREE.Material>} */
  const walls = {
    plain: () => lambert(),
    'noise, scale from camera': () => worldVariation(lambert(), { scale: noiseScale, strength: NOISE.strength }),
    'noise, tuned up close': () => worldVariation(lambert(), { scale: CLOSE_UP_SCALE, strength: NOISE.strength }),
    'brush + cavity + wear': (g, occluders) => {
      cavity(g, { occluders, ...CAVITY });
      const m = new THREE.MeshLambertMaterial({ color: COLORS.wall, vertexColors: true });
      worldVariation(m, { scale: brushScale, strength: BRUSH.strength, texture: brushTexture() });
      return edgeWear(g, m, WEAR);
    },
  };
  return {
    walls, scales: { noise: noiseScale, brush: brushScale, closeUp: CLOSE_UP_SCALE, dist, viewH },
    roof: new THREE.MeshLambertMaterial({ color: COLORS.roof }), ground: new THREE.MeshLambertMaterial({ color: COLORS.ground }),
    crate: new THREE.MeshLambertMaterial({ color: 0xffffff }),   // white: the instance colors are the crates' whole color
    /** @param {THREE.InstancedMesh} im */
    crateSame(im) { for (let i = 0; i < im.count; i++) im.setColorAt(i, new THREE.Color(COLORS.crate)); },
    /** @param {THREE.InstancedMesh} im */
    crateJitter(im) { jitterInstances(im, COLORS.crate, JITTER); },
  };
}
