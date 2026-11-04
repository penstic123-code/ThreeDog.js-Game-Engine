// The exhibits that are not in the world example's art (../world/art), built in code and registered by name in main.js (content/templates.js places them).
// Every surface is a material by name from picture/materials.js, so a picture change touches picture/ alone.
// Shadow flags are set here, on the model (the engine does not guess them).
import { THREE, mergeColored } from '../../index.js';
import { mat } from './picture/materials.js';
import { ROOM } from './picture/palette.js';

const mesh = (geo, material) => {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = m.receiveShadow = true;
  return m;
};
const box = (w, h, d, x, y, z, color) => [new THREE.BoxGeometry(w, h, d).translate(x, y, z), color];

/** A wooden crate: planks on a frame */
export function woodBlock() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6).translate(0, 0.8, 0), mat.crate));
  for (const y of [0.35, 0.8, 1.25]) g.add(mesh(new THREE.BoxGeometry(1.64, 0.06, 1.64).translate(0, y, 0), mat.crateBand));
  return g;
}

/** A rough stone block (faceted) */
export function stoneBlock() {
  const geo = new THREE.DodecahedronGeometry(1, 0).scale(1.1, 0.95, 1).translate(0, 0.85, 0);
  return mesh(geo, mat.stone);
}

/** A metal ball on a plinth: the surface that needs environment light to look like metal */
export function metalBall() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.3, 12).translate(0, 0.15, 0), mat.plinth));
  g.add(mesh(new THREE.SphereGeometry(0.85, 24, 16).translate(0, 1.2, 0), mat.metal));
  return g;
}

/** Two glass panes in front of a colored block: shows transparency, sorting and what is seen through it */
export function glassPanes() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.4, 1.4, 0.4).translate(0, 0.9, -0.9), mat.block));
  for (const [x, z, material] of /** @type {[number, number, THREE.Material][]} */ ([[-0.4, 0, mat.pane], [0.5, 0.5, mat.paneAmber]])) {
    const pane = mesh(new THREE.BoxGeometry(1.5, 2, 0.06).translate(x, 1, z), material);
    pane.castShadow = false;
    g.add(pane);
  }
  return g;
}

/** A pale slab with a pillar and a ball standing on it: the shadow receiver (edge softness, shadow darkness, acne) */
export function shadowStage() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(5, 0.15, 5).translate(0, 0.075, 0), mat.slab));
  g.add(mesh(new THREE.BoxGeometry(0.7, 2.4, 0.7).translate(-1, 1.35, -0.6), mat.plaster));
  g.add(mesh(new THREE.IcosahedronGeometry(0.6, 1).translate(1, 0.75, 0.4), mat.plaster));
  return g;
}

/**
 * A small room, 6 x 5 m, front (+z) toward the overview camera. Walls with a window and a door, a flat roof, a table, a bed and a lamp
 * (picture.addLamp lights it at night). Outside it shows the walls in sun; inside, the window light against the dark corners.
 */
export function room() {
  const g = new THREE.Group();
  const { wall: WALL, trim: TRIM, floor: FLOOR, roof: ROOF } = ROOM;
  const parts = [
    box(6.4, 0.2, 5.4, 0, 0.1, 0, FLOOR),                                // floor slab
    box(6, 3, 0.2, 0, 1.6, -2.4, WALL), box(0.2, 3, 5, -2.9, 1.6, 0, WALL), box(0.2, 3, 5, 2.9, 1.6, 0, WALL),   // back, left, right walls
    // front wall (z = +2.4) with a window (x -2.2..-0.8, y 1..2.2) and a door (x 1.4..2.4)
    box(0.8, 3, 0.2, -2.6, 1.6, 2.4, WALL), box(1.4, 0.8, 0.2, -1.5, 0.7 + 0.2, 2.4, WALL), box(1.4, 0.8, 0.2, -1.5, 2.6 + 0.2, 2.4, WALL),
    box(2.2, 3, 0.2, 0.3, 1.6, 2.4, WALL), box(1, 0.8, 0.2, 1.9, 2.6 + 0.2, 2.4, WALL), box(0.6, 3, 0.2, 2.7, 1.6, 2.4, WALL),
    box(1.6, 0.08, 0.3, -1.5, 1.04 + 0.2, 2.5, TRIM),                      // window sill
    box(6.8, 0.25, 5.8, 0, 3.3, 0, ROOF),                              // flat roof
  ];
  const shell = mesh(mergeColored(/** @type {any} */ (parts)), mat.shell);
  g.add(shell);
  // furniture: a table and a bed in the dark half of the room
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.1, 0.8).translate(1.2, 0.85, -1.2), mat.crateBand));
  for (const [x, z] of [[0.6, -1.5], [1.8, -1.5], [0.6, -0.9], [1.8, -0.9]]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08).translate(x, 0.5, z), mat.tableLeg));
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.4, 2).translate(-2, 0.5, -1.2), mat.bedFrame));
  g.add(mesh(new THREE.BoxGeometry(1.1, 0.15, 1.2).translate(-2, 0.78, -1.6), mat.linen));
  // window glass and the lamp
  const glass = mesh(new THREE.BoxGeometry(1.4, 1.2, 0.04).translate(-1.5, 1.6, 2.4), mat.window);
  glass.castShadow = false;
  g.add(glass);
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 2.8, 0), mat.lamp));
  return g;
}
