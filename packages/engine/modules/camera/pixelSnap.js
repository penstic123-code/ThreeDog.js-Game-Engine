// pixelSnap on a camera rig (followCamera, fixedCamera). The rig places the camera as it likes, then rigModule calls apply() once (common.js): that one call site is why the
// rigs carry no copy of this, and the math itself is pixelGrid's. While it is on, the view height belongs here: buffer rows / pixelsPerMeter, so a resize or
// engine.setPixelSize keeps the same world-to-pixel scale. A `size` of the game's would make the grid and the picture disagree, so options refuse it and a later write is
// reported by name.
import { pixelGrid } from '../../core/scene/pixel.js';
import { setProjection } from '../../core/scene/view.js';
import { codedError, coded } from '../../core/base/errorHints.js';
import { warnOnce } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';

const KEYS = keysSchema(['pixelsPerMeter', 'bounds']);

class RigPixelSnap {
  constructor(engine, { pixelsPerMeter, bounds = null }) {
    this.engine = engine; this.bounds = bounds;
    this.grid = pixelGrid({ camera: engine.camera, pixelsPerMeter });
    /** False while something else changed the view height (camera.zoom, the frustum): nothing is rounded then, a grid that does not match the picture means nothing */
    this.agrees = true;
    /** The last rounding, in art pixels on the screen axes */
    this.error = { x: 0, y: 0 };
    this._wrote = null;   // the view height this rig last set: anything else showing means an outside write
  }
  _write() { this._wrote = this.grid.viewHeight(this.engine.renderer.domElement.height); setProjection(this.engine, 'orthographic', this._wrote); }
  /** The rig became the camera */
  enter() { this._write(); this.grid.camera = this.engine.camera; }
  /** After the rig's update: view height, bounds, rounding */
  apply() {
    const cam = this.engine.camera, c = this.engine.renderer.domElement, g = this.grid;
    // engine.camera was assigned: the same grid goes on (sprites hold it), and the view height the new camera came with is no outside write
    if (g.camera !== cam) { g.camera = cam; if (cam.isOrthographicCamera) this._wrote = null; }
    this.agrees = !!cam.isOrthographicCamera && (this._wrote == null || g.agrees(this._wrote * g.pixelsPerMeter));
    if (!this.agrees) {
      warnOnce(coded('pixel-conflict', `pixelSnap: something else set the view height (camera.zoom, the frustum or a perspective view), so the camera no longer shows the ${this._wrote} world units `
        + `that pixelsPerMeter ${g.pixelsPerMeter} needs and rounding has stopped. Keep pixelSnap and put them back (to zoom, use engine.setPixelSize), or drop pixelSnap`));
      return;
    }
    this._write();
    const r = g.place(cam.position, { columns: c.width, rows: c.height, bounds: this.bounds });
    cam.position.copy(r.position);
    this.error.x = r.error.x; this.error.y = r.error.y;
  }
  describe() { return { pixelsPerMeter: this.grid.pixelsPerMeter, viewHeight: this._wrote, agrees: this.agrees, error: { ...this.error } }; }
}

/**
 * A view pixelSnap can own: orthographic, with no size of its own. Thrown here, named, at the option that is wrong.
 * @param {string} who the rig or shot, for the message @param {{ projection?: string, size?: number | null }} view
 */
export function checkPixelView(who, { projection, size }) {
  if (projection !== 'orthographic') throw codedError('camera-option', `${who}: pixelSnap works on an orthographic camera only, a perspective view has no single art pixel size. Add projection: 'orthographic', or drop pixelSnap`);
  if (size != null) throw codedError('pixel-conflict', `${who}: size ${size} with pixelSnap, which decides the view height itself (buffer height / pixelsPerMeter). Drop size, or drop pixelSnap`);
}

/**
 * The pixelSnap option of a rig: null when not asked for. Each rig calls this from its constructor, and enter() from onEnter.
 * @param {any} engine @param {any} opts the pixelSnap option @param {string} who the rig's name, for messages
 */
export function rigPixelSnap(engine, opts, who) {
  if (!opts) return null;
  readParams(`${who} pixelSnap`, KEYS, opts);
  return new RigPixelSnap(engine, opts);
}
