// Plain three.js lights are adopted (docs/plans/2026-11-03-slot-map.md, lights row): a `new THREE.PointLight` / `SpotLight` the game puts anywhere
// in the scene gets what a lightPool light gets, without the game naming it to the engine:
//   · counted: engine.budget categories `lights` (visible point + spot lights, pooled ones included: every one costs every lit pixel) and
//     `shadowLights` (those casting, 0 while renderer.shadowMap.enabled is off); describe().render.lights lists the game's lights with the file:line that added them
//   · the idle-shadow rule: a shadow-casting light at intensity 0 stops redrawing its shadow map (a point light is six shadow passes a frame
//     for a light that lights nothing) and redraws once it is lit again. This is the one setting of a game light the engine writes, so it is
//     kept to what it took: only a light whose shadow.autoUpdate was on is idled; only a light the engine idled gets autoUpdate back; a
//     game that writes autoUpdate itself while the light is idled (its own redraw plan) gets the light handed back and never idled again;
//     light.userData.idleShadow = false opts one light out; describe().render.lights says shadowIdled: true while the engine holds one.
//     Listed in threePatches as 'light-idle-shadow' (off() stops it for every light).
// What stays the game's: color, intensity, distance, castShadow (turning shadows off is the renderer's switch, core/look/shadowPart.js), the shadow map size and bias. The engine never writes them (P1).
// lightPool stays the optional helper for "many lamps, few real lights": that trade-off is a game decision the engine cannot guess.
// Cost: a scene visitor (no walk per frame); per frame one loop over the shadow-casting game lights, usually zero to three.
import { sceneVisitor } from './sceneDelta.js';
import { moduleOwnerOf } from './things.js';
import { notePatch, patchOn } from './threePatches.js';

const MANY = 8;   // same line as the dev warning in lightWatch.js: above it every lit material slows down first on mobile GPUs

/** The engine module that owns o (it or an ancestor carries engineOwned), else null */
function engineOwner(o) { for (let p = o; p; p = p.parent) { const m = moduleOwnerOf(p); if (m) return m; } return null; }

/** @param {any} e */
export function watchGameLights(e) {
  const all = new Set(), game = new Set(), idled = new WeakSet(), handed = new WeakSet();
  const view = sceneVisitor(e.scene, {
    enter(o) {
      if (!o.isPointLight && !o.isSpotLight) return;
      all.add(o);
      if (!o.userData.fixedCount && !engineOwner(o)) game.add(o);
    },
    leave(o) {
      all.delete(o); game.delete(o);
      if (idled.has(o)) { idled.delete(o); o.shadow.autoUpdate = true; o.shadow.needsUpdate = true; }   // leaves as the game left it
    },
  });
  const count = (fn) => { view.sync(); let n = 0; for (const l of all) if (fn(l)) n++; return n; };
  const shown = l => { for (let p = l; p; p = p.parent) if (!p.visible) return false; return true; };
  e.budget.metric('lights', () => count(l => shown(l) && l.intensity > 0), { limit: MANY });
  e.budget.metric('shadowLights', () => e.renderer.shadowMap.enabled ? count(l => shown(l) && l.castShadow && l.intensity > 0) : 0);
  e._gameLights = {
    /** The game's own point / spot lights (not a module's, not a pool's) */
    list() { view.sync(); return [...game]; },
    /** Before each render (loop.js): the idle-shadow rule */
    frame() {
      view.sync();
      for (const l of game) {
        if (!l.castShadow && !idled.has(l)) continue;
        const s = l.shadow;
        const opted = !patchOn('light-idle-shadow') || l.userData.idleShadow === false;
        if (idled.has(l)) {
          if (s.autoUpdate) { idled.delete(l); handed.add(l); }   // the game turned redraws on itself while idled: its light from now on
          else if (l.intensity > 0 || !l.castShadow || opted) { idled.delete(l); s.autoUpdate = true; s.needsUpdate = true; }   // put back what was taken
        } else if (l.castShadow && l.intensity <= 0 && s.autoUpdate && !opted && !handed.has(l)) { s.autoUpdate = false; idled.add(l); }
      }
    },
    /** Whether the engine holds this light's shadow redraw now (describe) */
    idled: l => idled.has(l),
  };
}
notePatch('light-idle-shadow', "shadow.autoUpdate of the game's own shadow-casting point / spot lights: off while intensity is 0, back on when lit (core/gameLights.js)",
  () => {}, { scope: 'objects in the scene', lost: 'a casting light at intensity 0 redraws its shadow map every frame, as in plain three.js' });
