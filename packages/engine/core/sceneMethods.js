// Scene and render settings on the engine (split out of Engine.js): add / detach / remove objects, pixel ratio, shadows, fog distance.
export const sceneMethods = {
  add(...objs) { this.scene.add(...objs); return objs[0]; },
  /** Detach from the parent only (no GPU release; use when you will add it back). Use remove for objects you are done with */
  detach(...objs) { for (const o of objs) o.removeFromParent(); },
  /**
   * Delete an object for good: detach it, unregister its rays and dispose geometries and materials (textures are kept). Geometry and materials shared by assets
   * model clones are only decremented in use count (see Assets.js)
   */
  remove(...objs) {
    for (const o of objs) {
      o.removeFromParent();
      this.rays.forget(o);
      this.assets.forget(o);
      const shared = this.assets.shared, held = this.batching.held;   // a batch still drawing the same geometry / material keeps it alive
      o.traverse(c => {
        if (c.geometry && !shared.has(c.geometry) && !held.has(c.geometry)) c.geometry.dispose();
        for (const m of [].concat(c.material || [])) if (!shared.has(m) && !held.has(m)) m.dispose();
      });
    }
  },
  setPixelRatio(p) { this.renderer.setPixelRatio(p); this.post.setPixelRatio(p); },
  /**
   * Master shadow switch. Off: remember each light's castShadow (the game's choice) then turn it off; on: restore only the lights that cast before (lights the
   * game turned off stay off).
   * Lights added while off are left alone (the renderer has shadows off, so it makes no difference).
   */
  setShadows(on) {
    this.shadows = on;
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse(o => {
      if (o.isLight && o.shadow) {
        const u = o.userData;
        if (!on) { if (!('threedogCastShadow' in u)) u.threedogCastShadow = o.castShadow; o.castShadow = false; }
        else if ('threedogCastShadow' in u) { o.castShadow = u.threedogCastShadow; delete u.threedogCastShadow; }
      }
      if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true);
    });
    this.events.emit('settings:shadows', on);
  },
  setFogFar(d) {
    this.fogFar = d;
    if (this.scene.fog) { this.scene.fog.far = d; this.scene.fog.near = d * 0.3; }
    this.camera.far = d + 150; this.camera.updateProjectionMatrix();
  }
};
