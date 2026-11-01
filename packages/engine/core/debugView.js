// Diagnostic view modes behind engine.debug.view('albedo' | 'lighting' | 'shadow' | 'normals' | 'off') (DebugOverrides.js).
// Temporary and owner-scoped: it changes how the scene is drawn (material swap / scene.overrideMaterial / lights hidden) and puts everything back on 'off'
// or when its owner clears (engine.debug.clear(owner)). Never saved, never part of the game's state; describe().render says so while one is active,
// so an AI reading a screenshot does not take "all white clay" for the real look.
// Why a view is an entry of the debug override chain and not its own material swap: two independent swaps on one mesh restored each other's stale
// material and disposed the real one (review H3). In the chain, the albedo view is a { material: 'flat' } entry on the scene and the other modes an apply()
// entry whose undo only puts back what it changed, and only disposes the override material it created.
// One view at a time, held as a claim (core/claims.js): only its owner (or force) switches it or turns it off.
import * as THREE from 'three';
import { warnMissing } from './validate.js';
import { claims } from './claims.js';

const VIEW_MODES = ['albedo', 'lighting', 'shadow', 'normals', 'off'];
const EXPLAIN = {
  albedo: 'unlit base color and texture only (no lights, no shadows)',
  lighting: 'every surface plain white matte: shows only what the lights do (no textures)',
  shadow: 'plain white matte lit by direct lights only (ambient and hemisphere lights hidden): shadows read as black',
  normals: 'surface normals as color (x/y/z -> r/g/b); a normal map shows here, flat shading looks faceted',
};

/** apply() for the scene-wide modes: returns an undo that restores only what this call changed */
function sceneMode(mode) {
  return scene => {
    // plain three materials on purpose: a diagnostic must not depend on the style pack it diagnoses
    const mat = mode === 'normals' ? new THREE.MeshNormalMaterial() : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });   // debug view only
    const was = scene.overrideMaterial, hidden = [];
    scene.overrideMaterial = mat;
    if (mode === 'shadow') scene.traverse(o => { if ((o.isAmbientLight || o.isHemisphereLight || o.isLightProbe) && o.visible) { o.visible = false; hidden.push(o); } });
    return () => {
      if (scene.overrideMaterial === mat) scene.overrideMaterial = was;
      mat.dispose();   // ours: created above
      for (const l of hidden) if (!l.visible) l.visible = true;
    };
  };
}

export class DebugView {
  /** @param {any} engine @param {any} debug the engine.debug override chain it lives in */
  constructor(engine, debug) {
    this.engine = engine; this.debug = debug;
    /** @type {{ mode: string, owner: string } | null} the active view (null = the real look) */
    this.active = null;
    this._holder = claims({ what: 'engine.debug.view', now: () => engine.elapsed ?? 0 });
    this._entry = null;
  }
  /**
   * Show a diagnostic view; 'off' restores the real look. Temporary: never saved, and a game that reads it must not branch on it.
   * owner names who asked ('debug' by default): while one owner's view is on, another owner can neither switch it nor turn it off unless it passes force.
   * @param {'albedo' | 'lighting' | 'shadow' | 'normals' | 'off'} mode
   * @param {{ owner?: string, force?: boolean }} [opts]
   * @returns {{ mode: string, owner: string | null, what?: string, note?: string }}
   */
  set(mode, { owner = 'debug', force = false } = {}) {
    if (!VIEW_MODES.includes(mode)) { warnMissing('debug view', String(mode), VIEW_MODES); return this.state(); }
    const a = this.active;
    if (a && a.owner !== owner && !force) return { ...this.state(), note: `view "${a.mode}" belongs to "${a.owner}"; pass { owner: '${a.owner}' } or force: true to ${mode === 'off' ? 'clear' : 'switch'} it` };
    this._off();
    if (mode === 'off') return this.state();
    const e = this.engine, scene = e.scene;
    const patch = mode === 'albedo' ? { material: 'flat' } : { apply: sceneMode(mode) };
    this._entry = this.debug._add({ owner, id: 'view:' + mode, byId: false, obj: scene, patch, undo: null, view: true });
    this._holder.take(owner, { mode });
    this.active = { mode, owner };
    return this.state();
  }
  /** Turn off the view if owner holds it (engine.debug.clear(owner)); true when it did */
  releaseOwner(owner) { if (this.active?.owner !== owner) return false; this._off(); return true; }
  /** @returns {{ mode: string, owner: string | null, what?: string }} the active view, or { mode: 'off' } */
  state() { return this.active ? { ...this.active, what: EXPLAIN[this.active.mode] } : { mode: 'off', owner: null }; }
  /** Who holds the view, the same shape as every other claim: [{ owner, at }] */
  owners() { return this._holder.owners(); }
  _off() {
    this._entry?.remove(); this._entry = null;
    this._holder.clear(); this.active = null;
  }
}
