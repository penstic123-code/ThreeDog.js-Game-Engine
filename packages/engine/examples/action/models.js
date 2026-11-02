// Models this example builds in code (floor, wall, pillar, enemy), registered by name through assets.js and placed by content/templates.js + props.js.
// Colors come from the style's `action` key (look.js, merged as a style part); with no style every model is the engine's neutral gray.
// Written with `function` (not arrows): a generator's `this` is { palette, engine }, so it reads the style without closing over an engine,
// which keeps this file importable on its own (assets.js, `npm run check`).
import { THREE, makeMaterial } from '../../index.js';

const look = ctx => ctx?.engine?.style?.action ?? {};
const mesh = (geo, role, color) => {
  const m = new THREE.Mesh(geo, makeMaterial(role, color === undefined ? {} : { color, flatShading: true }));
  m.castShadow = m.receiveShadow = true;
  return m;
};

/** Model generators that read their colors from engine.style.action (missing = gray) */
export const models = {
  floor() { return mesh(new THREE.BoxGeometry(16, 0.2, 16).translate(0, -0.1, 0), 'prop', look(this).floor); },
  wall() { return mesh(new THREE.BoxGeometry(16, 2.4, 0.5).translate(0, 1.2, 0), 'prop', look(this).wall); },
  pillar() { return mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.8, 8).translate(0, 1.4, 0), 'prop', look(this).pillar); },
  // A squat body with two eyes: the eyes face +Z, the facing every character uses (CONVENTIONS: characters face +Z)
  enemy() {
    const g = new THREE.Group(), c = look(this);
    g.add(mesh(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 0.75, 1).translate(0, 0.42, 0), 'character', c.enemy));
    for (const x of [-0.2, 0.2]) g.add(mesh(new THREE.SphereGeometry(0.09, 6, 4).translate(x, 0.6, 0.48), 'character', c.eye));
    return g;
  },
};
