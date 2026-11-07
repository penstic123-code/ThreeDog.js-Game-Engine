// @ts-check
// __NAME__ placeholder sprite sheet, drawn in code so the folder runs with no art files: a gray figure, 4 columns x 3 rows of 16x24 frames
// (rows: idle, walk, jump, as ROW in main.js). The art is yours: draw or import a real sheet (engine.assets.texture(name, { pixelated: true }), recipe 13 section 3c) and delete this.
import { THREE } from 'threedog';

export const SHEET = { frameWidth: 16, frameHeight: 24, columns: 4, rows: 3 };

/** A sheet material for pixelSprite: nearest filter and alphaTest, so edges stay hard (recipe 62 section 4b). tone: the figure's gray, so two sprites differ */
export function placeholderSheet(tone = 0x9a9a9a) {
  const { frameWidth: w, frameHeight: h, columns, rows } = SHEET;
  const canvas = Object.assign(document.createElement('canvas'), { width: w * columns, height: h * rows });
  const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const body = '#' + tone.toString(16).padStart(6, '0');
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x = c * w, y = r * h, bob = r === 1 ? (c % 2) : 0, lift = r === 2 ? 2 : 0;
    g.fillStyle = body; g.fillRect(x + 4, y + 8 - bob - lift, 8, 12);                      // body
    g.fillRect(x + 5, y + 2 - bob - lift, 6, 6);                                           // head
    g.fillStyle = '#444'; g.fillRect(x + 4, y + 20 - lift, 3, 4); g.fillRect(x + 9, y + 20 - lift, 3, 4);   // feet
    g.fillStyle = '#222'; g.fillRect(x + 9, y + 4 - bob - lift, 1, 1);                     // an eye on the right: the facing shows when the frame is mirrored
  }
  const map = new THREE.CanvasTexture(canvas);
  map.magFilter = map.minFilter = THREE.NearestFilter; map.generateMipmaps = false; map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
}
