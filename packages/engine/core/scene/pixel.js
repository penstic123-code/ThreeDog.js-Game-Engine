// Pixel-game math and the one object built on it (threedog/pixel). One art pixel on screen is `cell` = 1 / pixelsPerMeter world units along the camera's right and up
// axes. This file is the only place that derives those axes: the cameras' pixelSnap (modules/camera/pixelSnap.js) and pixelSprite call pixelGrid, so the camera and
// what it shows cannot round on two different grids. No default look: materials come from the game.
//
// Why rounding happens on screen axes and not world axes: a camera turned 45 degrees moves diagonally across world x and z, so world-axis rounding (or a world-axis
// clamp rounded afterwards) lands between art pixels. Why the view's corner goes on the lattice and not its center: with an odd number of art pixels the center sits on half
// a pixel, and every sprite edge would then fall exactly on a pixel center, where nearest sampling picks either side from frame to frame. The grid has no anchor to
// keep: its lattice runs through the world origin and the axes are read fresh on each call, so a zoom or a turn needs no reset.
import * as THREE from 'three';
import { codedError } from '../base/errorHints.js';

const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
// a view looking almost straight down would stretch a vertical sprite without limit; a sprite that tall is already unreadable
const MIN_COS_PITCH = 0.05;
const TIE = 1e-4;

/**
 * The art pixel grid of an orthographic camera. Pure math on the camera's current orientation.
 * @param {{ camera: THREE.Camera, pixelsPerMeter: number }} o
 */
export function pixelGrid({ camera, pixelsPerMeter } = /** @type {any} */ ({})) {
  if (!camera?.isCamera) throw codedError('camera-option', 'pixelGrid({ camera, pixelsPerMeter }): camera is the camera that draws the picture, usually engine.camera');
  if (!(pixelsPerMeter > 0)) throw codedError('camera-option', `pixelGrid({ pixelsPerMeter }): how many art pixels one world unit covers, above 0; got ${JSON.stringify(pixelsPerMeter)}`);
  const t = 1 / pixelsPerMeter, right = new THREE.Vector3(), up = new THREE.Vector3(), forward = new THREE.Vector3(), axes = { right, up, forward };
  const placed = { position: new THREE.Vector3(), error: { x: 0, y: 0 } }, shift = { x: 0, y: 0 }, _t = new THREE.Vector3();
  const round = v => Math.round(v / t) * t;
  const grid = {
    camera, pixelsPerMeter, cell: t,
    /** The camera's unit right, up and forward axes now. Throws on a perspective camera: its screen axes change across the picture, so no grid fits */
    axes() {
      if (!grid.camera.isOrthographicCamera) throw codedError('camera-option', "pixelGrid and pixelSnap work on an orthographic camera only: a perspective view has no single art pixel size. Set projection: 'orthographic' on the camera, or drop pixelSnap");
      grid.camera.getWorldQuaternion(_q);
      right.set(1, 0, 0).applyQuaternion(_q); up.set(0, 1, 0).applyQuaternion(_q); forward.set(0, 0, -1).applyQuaternion(_q);
      return axes;
    },
    /** World point -> meters along the screen axes: x right, y up, z forward */
    toScreen(world, out = new THREE.Vector3()) {
      grid.axes();
      return out.set(right.dot(world), up.dot(world), forward.dot(world));
    },
    /** Meters along the screen axes -> world point */
    toWorld(screen, out = new THREE.Vector3()) {
      grid.axes();
      const { x, y, z } = screen;
      return out.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(forward, z);
    },
    /** The world point rounded to the art grid on the two screen axes; depth stays, so what is in front stays in front */
    snap(world, out = new THREE.Vector3()) {
      const s = grid.toScreen(world, _s);
      return grid.toWorld(s.set(round(s.x), round(s.y), s.z), out);
    },
    /** How far snap moves this point, in art pixels on each screen axis (-0.5 to 0.5). Handed over for a game that wants to use the leftover */
    error(world) {
      const s = grid.toScreen(world, _s);
      return { x: (round(s.x) - s.x) / t, y: (round(s.y) - s.y) / t };
    },
    /**
     * snap for what the camera follows. Its offset from the camera's exact position is what must stay steady on screen, so it takes the rounding the camera got in
     * place(). snap() would round the two on their own, and they would step on different frames: a one-pixel shake. Use it for that one object: a thing standing
     * still would creep against the ground as the leftover changes.
     */
    snapFollowed(world, out = new THREE.Vector3()) {
      const s = grid.toScreen(world, _s);
      // the small bias: with an odd buffer a follower at the view's center is exactly half a pixel off the grid, and float noise would flip that tie every frame
      return grid.toWorld(s.set(round(s.x + shift.x + t * TIE), round(s.y + shift.y + t * TIE), s.z), out);
    },
    /** World units of view height a picture of `rows` art pixels needs */
    viewHeight(rows) { return rows * t; },
    /** Does the camera really show rows / pixelsPerMeter of the world? If not, the grid and the picture disagree. Read from the projection, so camera.zoom counts */
    agrees(rows) { return Math.abs(2 / grid.camera.projectionMatrix.elements[5] - rows * t) <= rows * t * 1e-6; },
    /**
     * Where a camera wanting `position` goes: clamp, then round. Bounds { minX, maxX, minZ, maxZ, minY?, maxY? } are projected on the screen axes and rounded inward, and
     * the view's corner is clamped to them, so the rounding after it cannot cross a bound. A level smaller than the view is centered on that axis. Result: { position,
     * error } (both reused between calls), error in art pixels from the clamped position.
     * @param {THREE.Vector3} position @param {{ columns: number, rows: number, bounds?: any }} view
     */
    place(position, { columns, rows, bounds }) {
      const fit = (v, size, key, axis) => {
        let corner = v - size / 2;
        if (bounds) {
          let lo = Infinity, hi = -Infinity;
          for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY ?? 0, bounds.maxY ?? 0]) for (const z of [bounds.minZ, bounds.maxZ]) {
            const d = x * axis.x + y * axis.y + z * axis.z;
            if (d < lo) lo = d;
            if (d > hi) hi = d;
          }
          const a = Math.ceil(lo / t) * t, b = Math.floor((hi - size) / t) * t;
          corner = a > b ? (lo + hi - size) / 2 : Math.min(b, Math.max(a, corner));
        }
        const rounded = round(corner);
        placed.error[key] = (rounded - corner) / t; shift[key] = rounded - corner;
        return rounded + size / 2;
      };
      const s = grid.toScreen(position, _t);
      s.x = fit(s.x, columns * t, 'x', right); s.y = fit(s.y, rows * t, 'y', up);
      grid.toWorld(s, placed.position);
      return placed;
    },
  };
  return grid;
}

/**
 * Write a sheet frame into a sprite's UVs. Frames count left to right, top to bottom. flip mirrors it on the UVs, not with a negative scale, so the triangle's winding and
 * its shadow stay right.
 * @param {THREE.Mesh} mesh @param {number} frame @param {boolean} [flip] left out: as it was
 */
export function spriteFrame(mesh, frame, flip) {
  const d = mesh.userData.pixelSprite;
  if (!d) throw codedError('engine-misuse', 'spriteFrame(mesh, frame): the mesh must come from pixelSprite()');
  if (!(Number.isInteger(frame) && frame >= 0 && frame < d.columns * d.rows)) throw codedError('engine-misuse', `spriteFrame: frame ${JSON.stringify(frame)} is outside the sheet, which has ${d.columns * d.rows} frames`);
  d.frame = frame; d.flip = flip ?? d.flip;
  const c = frame % d.columns, r = Math.floor(frame / d.columns), u0 = c / d.columns, u1 = (c + 1) / d.columns, v1 = 1 - r / d.rows, v0 = 1 - (r + 1) / d.rows;
  const [l, h] = d.flip ? [u1, u0] : [u0, u1], uv = mesh.geometry.attributes.uv;
  uv.setXY(0, l, v1); uv.setXY(1, h, v1); uv.setXY(2, l, v0); uv.setXY(3, h, v0);   // PlaneGeometry's order: top left, top right, bottom left, bottom right
  uv.needsUpdate = true;
  return mesh;
}

/**
 * A sprite for an orthographic view of a 3D scene: a plain THREE.Mesh, a vertical plane. Standing upright is what keeps a head out of the wall behind it: the whole figure
 * has the depth of its feet. A plane tilted toward the camera would lean its head back through that wall. The height is stretched by 1 / cos(pitch), which the view's
 * tilt takes back, so one texel is one art pixel.
 * Facing comes from the camera's forward direction, not its position: under an orthographic camera, aiming at the position would give every sprite a different angle.
 * It is applied just before drawing, because a character's root turns with its facing and the sprite must not. mesh.position stays exact (physics, saves, gameplay read it);
 * only the drawn matrix is rounded.
 * @param {{ grid: ReturnType<typeof pixelGrid>, material: THREE.Material, width: number, height: number, columns?: number, rows?: number, frame?: number, flip?: boolean,
 *   anchor?: [number, number], snap?: 'world' | 'followed' | false }} o width / height: one frame in texels; anchor: the point on the frame at the mesh's origin, 0 to 1 from the
 *   bottom left, feet by default; snap: 'followed' for the one object the camera follows (grid.snapFollowed)
 * @returns {THREE.Mesh}
 */
export function pixelSprite({ grid, material, width, height, columns = 1, rows = 1, frame = 0, flip = false, anchor = [0.5, 0], snap = 'world' } = /** @type {any} */ ({})) {
  if (!grid?.axes) throw codedError('engine-misuse', 'pixelSprite({ grid }): grid comes from pixelGrid() or engine.cameraRig.pixelSnap.grid');
  if (!material?.isMaterial) throw codedError('engine-misuse', 'pixelSprite({ material }): a three.js material of your own; the engine brings no look');
  if (!(width > 0 && height > 0)) throw codedError('engine-misuse', `pixelSprite({ width, height }): one frame's size in texels; got ${width} x ${height}`);
  if (![false, 'world', 'followed'].includes(snap)) throw codedError('engine-misuse', `pixelSprite({ snap: ${JSON.stringify(snap)} }): use 'world', 'followed' or false`);
  const t = grid.cell, w = width * t, h = height * t;
  // the anchor rounds to a whole texel: otherwise the frame's edges fall between art pixels once the anchor is on the grid
  const geometry = new THREE.PlaneGeometry(w, h).translate(w / 2 - Math.round(anchor[0] * width) * t, h / 2 - Math.round(anchor[1] * height) * t, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.pixelSprite = { columns, rows, frame, flip };
  spriteFrame(mesh, frame);
  mesh.onBeforeRender = () => {
    const f = grid.axes().forward, flat = Math.max(MIN_COS_PITCH, Math.hypot(f.x, f.z)), parent = mesh.parent;
    const turn = _pq.setFromAxisAngle(_y, Math.atan2(-f.x, -f.z));
    mesh.quaternion.copy(turn);
    if (parent) mesh.quaternion.premultiply(parent.getWorldQuaternion(_pq).invert());
    mesh.scale.y = 1 / flat;
    mesh.updateMatrix();
    if (parent) mesh.matrixWorld.multiplyMatrices(parent.matrixWorld, mesh.matrix); else mesh.matrixWorld.copy(mesh.matrix);
    if (snap) mesh.matrixWorld.setPosition(grid[snap === 'followed' ? 'snapFollowed' : 'snap'](_p.setFromMatrixPosition(mesh.matrixWorld), _p));
  };
  return mesh;
}
