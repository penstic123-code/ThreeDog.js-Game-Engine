// sheepisland procedural models: a round tree, a sheep, a wheat tuft. Built in code, no files; registered as an asset pack (assets.js).
// Colors and materials come by name from picture/, so a picture change never touches this file.
// Shapes are clusters of smooth spheres: the reference reads as soft blobs, not facets. Shadow flags are set here (the engine does not guess them).
import { THREE, mergeColored } from '../../index.js';
import { COLORS as c } from './picture/palette.js';
import { mat } from './picture/materials.js';

const mesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };
const ball = (r, x, y, z, detail = 3) => new THREE.IcosahedronGeometry(r, detail).translate(x, y, z);

// Crown blobs of the round tree: [radius, x, y, z]. Fixed, so every tree has the same silhouette; props vary scale and rotation.
const CROWN = [[1.7, 0, 3.6, 0], [1.25, 1.1, 3.1, 0.4], [1.2, -1.0, 3.2, -0.5], [1.1, 0.2, 4.6, -0.3], [1.0, -0.4, 3.0, 1.0]];

export const models = {
  /** A round tree: short trunk, crown of five soft blobs. The crown material takes the snow */
  roundTree: function () {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 8).translate(0, 1.3, 0), mat.bark));
    // two shades in one geometry: upper blobs lighter, as if lit from above; vertex colors so it stays one draw
    const crown = mergeColored(CROWN.map(([r, x, y, z], i) => [ball(r, x, y, z), i === 3 ? c.leafLight : c.leaf]), { flat: false });   // flat: false = smooth blobs (the default is faceted)
    g.add(mesh(crown, mat.leaf));
    return g;
  },

  /** A sheep, about 1.4 m long, facing +Z: a body of wool blobs, a black head and four black legs */
  sheep: function () {
    const g = new THREE.Group();
    const wool = mergeColored([[0.5, 0, 0.75, 0], [0.42, 0, 0.8, 0.38], [0.42, 0, 0.8, -0.38], [0.36, 0.22, 0.98, 0], [0.36, -0.22, 0.98, 0.1]]
      .map(([r, x, y, z]) => [ball(r, x, y, z, 2), c.wool]), { flat: false });
    g.add(mesh(wool, mat.wool));
    const black = mat.face;
    g.add(mesh(new THREE.SphereGeometry(0.22, 16, 12).scale(0.85, 1, 1.25).translate(0, 0.9, 0.78), black));                  // head
    for (const [x, z] of [[0.2, 0.32], [-0.2, 0.32], [0.2, -0.32], [-0.2, -0.32]])
      g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6).translate(x, 0.25, z), black));                                  // legs
    return g;
  },

  /** One wheat tuft for content vegetation (a generator returning a geometry): nine stalks with ears, vertex-colored, one draw per chunk */
  wheatTuft: function () {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, r = i ? 0.06 + 0.02 * i : 0, x = Math.cos(a) * r, z = Math.sin(a) * r, h = 0.85 + (i % 3) * 0.1;
      parts.push([new THREE.CylinderGeometry(0.012, 0.018, h, 3).translate(x, h / 2, z), c.wheat]);
      parts.push([new THREE.SphereGeometry(0.06, 5, 4).scale(1, 2.6, 1).translate(x, h + 0.08, z), c.wheatTip]);
    }
    return mergeColored(/** @type {any} */ (parts));
  },
};
