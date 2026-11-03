// The game draws the frame itself: the engine notices and yields the canvas instead of drawing a second picture over (or under) it.
// Why: plain three.js games build their own EffectComposer / RenderPipeline and call composer.render() (or renderer.render(scene, camera))
// in a requestAnimationFrame loop or in engine.onFrame. Before, the engine drew its own frame too, so every frame was drawn twice and
// whichever came last won (the game's bloom flickered or vanished). The owner's rule: what the engine can see it adopts; a game that draws
// the canvas has taken the "who draws the frame" slot, so the engine steps aside and says once how to hand it back.
// What is seen: a draw onto the canvas (render target null) on the engine's renderer outside the engine's own frame. The engine's frame is
// loop._render (scene, post chain, onRender before / after callbacks: an overlay drawn there is the engine's frame, not a takeover) and
// engine.renderOnce. Draws into a render target (mirrors, minimaps, a composer's inner passes) never count; only the composer's last pass,
// which writes the canvas, does. Neither does a layer drawn on top of the canvas, the usual three.js minimap / HUD lines
// (renderer.setScissorTest(true), a viewport smaller than the canvas, or autoClear = false with a scene other than engine.scene), wherever
// it runs (onFrame, a module's afterRender, the game's own requestAnimationFrame). Before, any canvas draw counted, so a minimap made the
// engine stop drawing the main picture and the screen showed only the minimap (review 2026-11-03). What counts is a draw that replaces
// the picture: the whole canvas, cleared first (autoClear on), or engine.scene itself (a RenderPass to the screen turns autoClear off).
// How it is seen: an own `render` property on the renderer instance (three's prototype is untouched, other renderers on the page are
// untouched), installed again when start() replaces the renderer; listed in threePatches as 'renderer-render'. Hand-back is automatic: an
// engine frame with no outside canvas draw since the previous one draws again, so deleting the game's own render call is the whole hand-back.
import { Vector2, Vector4 } from 'three';
import { warnOnce } from '../core/validate.js';
import { coded } from '../core/errorHints.js';
import { notePatch, patchOn } from '../core/threePatches.js';
import { onRendererSwap } from './backend.js';

const WRAPPED = Symbol.for('threedog.ownFrame');
const STRINGS = {
  took: 'the game draws the canvas itself ({what} drawn over the whole canvas outside the engine frame: renderer.render / composer.render), so the engine stopped drawing its own frame and its post chain (engine.post, look.post), adaptive resolution and photo mode do not apply to the picture. Fine if intended. To hand it back delete your render call; the engine draws again on the next frame. To keep the engine frame and add your pass: engine.look.post.add(pass). A layer on top (minimap, HUD) is not a takeover: draw it with renderer.setScissorTest(true), a smaller viewport, or autoClear = false, best in engine.onRender(fn, { when: \'after\' }) [own-frame]',
};
const _vp = new Vector4(), _size = new Vector2();

/** Whether this canvas draw replaces the picture (a takeover) rather than adding a layer over it (minimap, HUD) */
function replaces(engine, r, scene) {
  if (r.getScissorTest?.()) return false;
  if (r.getViewport) {
    r.getViewport(_vp); r.getSize(_size);
    if (_vp.x > 0 || _vp.y > 0 || _vp.z < _size.x || _vp.w < _size.y) return false;
  }
  return r.autoClear || scene === engine.scene;
}
/** The draw named in the warning: scene name or type, camera type */
const named = (scene, camera) => `${scene?.name ? `'${scene.name}'` : scene?.type ?? 'an object'} with ${camera?.type ?? 'a camera'}`;

notePatch('renderer-render', "engine.renderer.render (that one instance, not the class): counts the game's own full-canvas draws so the engine yields the frame (render/ownFrame.js)",
  () => {}, { scope: 'engine renderer', lost: 'a game drawing its own frame no longer stops the engine frame: both draw every frame' });

/**
 * Watch the engine's renderer for canvas draws outside the engine frame. engine._ownFrame: { inside, outside, yielded, what }
 * @param {any} engine @internal
 */
export function watchOwnFrame(engine) {
  const st = engine._ownFrame = { inside: 0, outside: 0, yielded: false, what: '' };
  const wrap = () => {
    const r = engine.renderer;
    if (!r || r[WRAPPED]) return;
    const orig = r.render;
    Object.defineProperty(r, WRAPPED, { value: true });
    r.render = function (...a) {
      if (!st.inside && patchOn('renderer-render') && r.getRenderTarget() === null && replaces(engine, r, a[0])) { st.outside++; st.what = named(a[0], a[1]); }
      return orig.apply(this, a);
    };
  };
  wrap();
  onRendererSwap(engine, wrap);
}

/**
 * The engine frame starts: true when it should draw (no outside canvas draw since the previous engine frame), false when the game holds
 * the canvas. Warns once on the first takeover. @param {any} engine @returns {boolean} @internal
 */
export function engineDraws(engine) {
  const st = engine._ownFrame;
  if (!st) return true;
  const took = st.outside > 0;
  st.outside = 0;
  if (took && !st.yielded) warnOnce(coded('own-frame', STRINGS.took.replace('{what}', st.what)));
  st.yielded = took;
  return !took;
}
