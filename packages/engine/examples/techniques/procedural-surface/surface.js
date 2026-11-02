// @ts-check
// Procedural surface: surface quality without texture files. Each function is one tool; a surface usually stacks two or three of them
// (a macro value variation + a micro texture + cavity / wear). Copy this file into a game; it imports only three and threedog.
// Everything that needs a browser (canvas) runs lazily inside a builder, never at import time, so `threedog check` can import the art code in Node.
import * as THREE from 'three';
import { applyEffects, bakeVertexAO } from 'threedog';

/**
 * Pattern frequency (repeats per meter) whose cells cover `cellPx` screen pixels at `distance` meters from this camera.
 * The lesson of the demos: detail tuned up close vanishes at the game's real camera (the engine's detail `fade` averages it away instead of
 * letting it shimmer). Pick the scale from the camera you ship, then check with a shot at that camera.
 * @param {{ fov: number }} camera a PerspectiveCamera, or just its vertical fov in degrees
 * @param {number} distance meters from the camera to the surface
 * @param {number} viewHeightPx drawing-buffer height in pixels (canvas height x pixel ratio)
 * @param {number} [cellPx] screen pixels one pattern cell should cover: 6-8 = fine but visible, 15-30 = large blotches
 */
export function scaleForCamera(camera, distance, viewHeightPx, cellPx = 12) {
  const metersPerPx = (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewHeightPx;
  return 1 / (cellPx * metersPerPx);
}

/**
 * World-space triplanar noise color variation on any lit material (the engine's `detail`, recipe 43): no UVs needed, the pattern does not
 * stretch on walls, and boxes side by side get different patches because it follows world position, not the object.
 * @param {THREE.Material} material
 * @param {{ scale: number, strength?: number, noise?: 'grain' | 'paper' | 'stroke' | 'dabs', texture?: THREE.Texture, octaves?: number }} o
 */
export function worldVariation(material, { scale, strength = 0.3, noise = 'grain', texture, octaves = 2 }) {
  return applyEffects(material, { detail: { projection: 'triplanar', scale, strength, octaves, ...(texture ? { texture } : { noise }) } });
}

let brush = /** @type {THREE.CanvasTexture | null} */ (null);
/**
 * A painted brush texture drawn on a canvas the first time it is asked for (inside a builder, never at module load). Light strokes on white,
 * so `multiply` only darkens a little and the base color stays the material's. Tiles: strokes that leave one side come back on the other.
 * @param {{ size?: number, strokes?: number, seed?: number }} [o]
 */
export function brushTexture({ size = 256, strokes = 420, seed = 7 } = {}) {
  if (brush) return brush;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  g.fillStyle = '#fff'; g.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);   // fixed seed: the same texture every run, screenshots comparable
  g.lineCap = 'round';
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * size, y = rnd() * size, a = -0.35 + rnd() * 0.25, len = size * (0.06 + rnd() * 0.12), v = 150 + rnd() * 90 | 0;
    g.strokeStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.22})`;
    g.lineWidth = 2 + rnd() * 6;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len); g.stroke();
    }
  }
  brush = new THREE.CanvasTexture(c);
  brush.wrapS = brush.wrapT = THREE.RepeatWrapping;
  brush.colorSpace = THREE.SRGBColorSpace;
  return brush;
}

/**
 * Cavity darkening: bake ambient occlusion into vertex colors (engine `bakeVertexAO`: rays from every vertex, BVH accelerated). Corners,
 * the foot of a wall and the underside of an overhang get darker. Needs enough vertices to carry it: give boxes segments.
 * Turn on `vertexColors` on the material. Baking costs load time (about 1 ms per 1000 vertices x 32 samples), nothing per frame.
 * @param {THREE.BufferGeometry} geometry
 * @param {{ occluders?: THREE.BufferGeometry[], strength?: number, radius?: number }} [o] occluders in the same local space (ground, roof)
 */
export function cavity(geometry, { occluders = [], strength = 0.8, radius } = {}) {
  return bakeVertexAO(geometry, { occluders, strength, radius, samples: 32 });
}

/**
 * Edge wear on a box: an attribute with each vertex's distance to the nearest box edge (meters), read by a patch that lightens a ragged
 * strip along the edges (chipped paint, worn stone corners). The noise breaks the strip so it does not look like a bevel.
 * Curvature-ish trick for other shapes: put any 0-at-the-edge distance in `aEdge` (from a bevel, a baked map, or 1 - vertex AO for cavities).
 * @param {THREE.BoxGeometry} geometry
 * @param {THREE.Material} material a lit material (lambert / standard / toon)
 * @param {{ width?: number, strength?: number, color?: THREE.ColorRepresentation, noiseScale?: number }} [o]
 */
export function edgeWear(geometry, material, { width = 0.08, strength = 0.6, color = 0xf2efe8, noiseScale = 9 } = {}) {
  const { width: w, height: h, depth: d } = geometry.parameters, half = [w / 2, h / 2, d / 2], p = geometry.attributes.position;
  const edge = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const a = [Math.abs(p.getX(i)), Math.abs(p.getY(i)), Math.abs(p.getZ(i))].map((v, k) => half[k] - v);
    const face = a.indexOf(Math.min(...a));            // the axis this vertex's face is perpendicular to
    edge[i] = Math.min(...a.filter((_, k) => k !== face));   // distance to the nearer of the face's edges
  }
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
  return applyEffects(material, { patches: [{
    name: 'edgeWear', cacheKey: 'v1', needs: { patches: ['world'] },
    uniforms: { uWearW: { value: width }, uWearK: { value: strength }, uWearC: { value: new THREE.Color(color) }, uWearN: { value: noiseScale } },
    pars: { vertex: 'attribute float aEdge; varying float vEdge;', fragment: 'varying float vEdge; uniform float uWearW; uniform float uWearK; uniform vec3 uWearC; uniform float uWearN;\n#include <threedog_detail>' },
    glsl: {
      position: 'vEdge = aEdge;',
      // engine noise (grain) at a scale finer than the strip: the edge of the wear is ragged, some corners worn deep, some barely
      color: `{ float n = threedogDetailNoise( vThreedogWorld.xy * uWearN + vThreedogWorld.zy * uWearN * 0.7, 0, 2.0 ).r;
        float wear = 1.0 - smoothstep( 0.0, uWearW, vEdge - ( n - 0.5 ) * uWearW * 1.6 );
        diffuseColor.rgb = mix( diffuseColor.rgb, uWearC, wear * uWearK ); }`,
    },
  }] });
}

/**
 * Per-instance hue / value jitter on an InstancedMesh (plain three.js instance colors): twenty crates from one material stop looking
 * stamped. Keep it small: hue a few hundredths, value under 10 %; more reads as different objects, not the same object aged differently.
 * @param {THREE.InstancedMesh} mesh
 * @param {THREE.ColorRepresentation} base
 * @param {{ hue?: number, value?: number, seed?: number }} [o]
 */
export function jitterInstances(mesh, base, { hue = 0.03, value = 0.1, seed = 3 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const c = new THREE.Color(), hsl = new THREE.Color(base).getHSL({ h: 0, s: 0, l: 0 });
  for (let i = 0; i < mesh.count; i++) {
    c.setHSL((hsl.h + rnd() * hue + 1) % 1, hsl.s, THREE.MathUtils.clamp(hsl.l * (1 + rnd() * value), 0, 1));
    mesh.setColorAt(i, c);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}
